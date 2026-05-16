// ===============================
// server.js v5.0 - THUẬT TOÁN BÁM/BẺ CẦU THÔNG MINH
// Cải tiến: nhận diện cầu chủ động, học thích ứng nâng cao, không bẻ quá sớm
// ===============================

const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const API_URL = "http://103.249.117.201:49483/sunwin/tx?key=f7fe0e32f71684bd95ec94f59609801364193b297db4d60e";

// ===============================
// LỊCH SỬ & HỌC THÍCH ỨNG NÂNG CAO
// ===============================
let history = [];           // [{phien, ket_qua, xuc_xac, tong, time}]
let predictionLog = [];     // [{phien, du_doan, signals, state, thuc_te, dung_sai}]

// Bộ nhớ độ chính xác theo từng loại cầu (thay vì từng tín hiệu riêng lẻ)
let cauAccuracy = {
    bet:     { correct: 0, total: 0 },   // bệt
    dao:     { correct: 0, total: 0 },   // cầu 1-1
    cau2:    { correct: 0, total: 0 },   // cầu 2-2
    cau3:    { correct: 0, total: 0 },   // cầu 3-3
    cau121:  { correct: 0, total: 0 },   // cầu 1-2-1
    cyclic:  { correct: 0, total: 0 },   // chu kỳ
    honloan: { correct: 0, total: 0 }    // không có cầu rõ ràng
};

let lastRawResponse = null;
let EMA_ACCURACY = 0.7;   // hệ số làm mới cho độ chính xác (càng cao càng ưu tiên gần đây)

// ===============================
// PARSE API - giữ nguyên
// ===============================
function extractPayload(raw) {
    if (!raw) return null;
    const candidates = [raw, raw?.data, raw?.debug?.data, raw?.result, raw?.response];
    for (const c of candidates) {
        if (!c || typeof c !== "object") continue;
        if (c.phien && (c.xuc_xac_1 || c.xuc_xac || c.dice || c.tong)) return c;
    }
    return null;
}

function getResult(total) {
    return total >= 11 ? "tài" : "xỉu";
}
function getResultArray(hist) {
    return hist.map(h => h.ket_qua);
}

// ===============================
// PHÁT HIỆN CẦU NÂNG CAO (trả về loại cầu và mức độ tin cậy)
// ===============================
function getCurrentStreak(results) {
    if (!results.length) return { value: "xỉu", length: 0 };
    const last = results[results.length - 1];
    let len = 1;
    for (let i = results.length - 2; i >= 0; i--) {
        if (results[i] === last) len++;
        else break;
    }
    return { value: last, length: len };
}

function detect11Pattern(results, minLen = 4) {
    if (results.length < minLen) return { detected: false, length: 0 };
    let count = 1;
    for (let i = results.length - 1; i >= 1; i--) {
        if (results[i] !== results[i - 1]) count++;
        else break;
    }
    return { detected: count >= minLen, length: count };
}

function detect22Pattern(results) {
    if (results.length < 6) return false;
    const r = results.slice(-12);
    const L = r.length;
    if (L >= 8 && r[L-1] === r[L-2] && r[L-3] === r[L-4] &&
        r[L-5] === r[L-6] && r[L-7] === r[L-8] &&
        r[L-1] !== r[L-3] && r[L-3] !== r[L-5] && r[L-5] !== r[L-7]) return true;
    if (L >= 6 && r[L-1] === r[L-2] && r[L-3] === r[L-4] &&
        r[L-5] === r[L-6] && r[L-1] !== r[L-3] && r[L-3] !== r[L-5] && r[L-1] === r[L-5]) return true;
    return false;
}

function detect33Pattern(results) {
    if (results.length < 8) return false;
    const r = results.slice(-15);
    const L = r.length;
    if (L >= 9 && r[L-1] === r[L-2] && r[L-2] === r[L-3] &&
        r[L-4] === r[L-5] && r[L-5] === r[L-6] &&
        r[L-7] === r[L-8] && r[L-8] === r[L-9] &&
        r[L-1] !== r[L-4] && r[L-4] !== r[L-7] && r[L-1] === r[L-7]) return true;
    if (L >= 6 && r[L-1] === r[L-2] && r[L-2] === r[L-3] &&
        r[L-4] === r[L-5] && r[L-5] === r[L-6] && r[L-1] !== r[L-4]) return true;
    return false;
}

function detect121Pattern(results) {
    if (results.length < 6) return false;
    const r = results.slice(-9);
    const L = r.length;
    if (L >= 6 && r[L-1] === r[L-4] && r[L-2] === r[L-5] && r[L-3] === r[L-6] &&
        r[L-1] !== r[L-2] && r[L-2] === r[L-3]) return true;
    return false;
}

function detectCyclicPattern(results, minCycles = 3) {
    if (results.length < 6) return null;
    const win = results.slice(-30);
    for (let period = 2; period <= 5; period++) {
        if (win.length < period * minCycles) continue;
        let matchCount = 0, total = 0;
        const startIdx = win.length - period;
        for (let offset = period; offset < win.length && offset < period * (minCycles + 2); offset += period) {
            const base = startIdx - offset + period;
            if (base < 0) break;
            let cycleMatch = 0;
            for (let j = 0; j < period; j++) {
                if (win[startIdx - j] !== undefined && win[base + period - 1 - j] !== undefined &&
                    win[startIdx - j] === win[base + period - 1 - j]) cycleMatch++;
            }
            total += period;
            matchCount += cycleMatch;
        }
        if (total > 0 && matchCount / total >= 0.85) {
            const posInCycle = win.length % period;
            const cycleStart = win.length - (win.length % period === 0 ? period : win.length % period);
            const predicted = win[cycleStart - period + posInCycle];
            if (predicted) return { detected: true, period, confidence: matchCount / total, predicted };
        }
    }
    return null;
}

// -------------------------------------------------------------
// NHẬN DIỆN LOẠI CẦU CHÍNH (với độ tin cậy)
// -------------------------------------------------------------
function detectCauState(results) {
    const streak = getCurrentStreak(results);
    const pattern11 = detect11Pattern(results);
    const is22 = detect22Pattern(results);
    const is33 = detect33Pattern(results);
    const is121 = detect121Pattern(results);
    const cyclic = detectCyclicPattern(results);

    // Bệt dài >= 5 -> ưu tiên bệt
    if (streak.length >= 5) {
        return { type: "bet", strength: Math.min(0.95, 0.6 + streak.length * 0.07), direction: streak.value };
    }
    // Bệt vừa 3-4 -> cũng bệt nhưng yếu hơn
    if (streak.length >= 3) {
        return { type: "bet", strength: 0.55 + streak.length * 0.05, direction: streak.value };
    }
    // Cầu 1-1 dài >= 5
    if (pattern11.detected && pattern11.length >= 5) {
        const opposite = results[results.length-1] === "tài" ? "xỉu" : "tài";
        return { type: "dao", strength: 0.8, direction: opposite };
    }
    if (pattern11.detected && pattern11.length >= 4) {
        const opposite = results[results.length-1] === "tài" ? "xỉu" : "tài";
        return { type: "dao", strength: 0.7, direction: opposite };
    }
    // Cầu 3-3 rất mạnh
    if (is33) {
        const opposite = results[results.length-1] === "tài" ? "xỉu" : "tài";
        return { type: "cau3", strength: 0.85, direction: opposite };
    }
    // Cầu 2-2 mạnh
    if (is22) {
        const opposite = results[results.length-1] === "tài" ? "xỉu" : "tài";
        return { type: "cau2", strength: 0.78, direction: opposite };
    }
    // Cầu 1-2-1
    if (is121) {
        let predict = (results[results.length-1] === results[results.length-2] && results[results.length-1] !== results[results.length-3])
            ? (results[results.length-1] === "tài" ? "xỉu" : "tài")
            : results[results.length-1];
        return { type: "cau121", strength: 0.7, direction: predict };
    }
    // Chu kỳ
    if (cyclic && cyclic.detected) {
        return { type: "cyclic", strength: cyclic.confidence * 0.9, direction: cyclic.predicted };
    }
    // Không có cầu rõ -> hỗn loạn
    return { type: "honloan", strength: 0.5, direction: null };
}

// -------------------------------------------------------------
// TÍNH XÁC SUẤT BẺ CẦU THÔNG MINH (không bẻ quá sớm, không theo quá đà)
// -------------------------------------------------------------
function adaptiveBreakProb(results, cauState) {
    const streak = getCurrentStreak(results);
    if (cauState.type === "bet") {
        // Nếu bệt quá dài (>=7) thì tăng dần khả năng bẻ
        if (streak.length >= 7) return 0.82;
        if (streak.length >= 5) return 0.70;
        if (streak.length >= 4) return 0.58;
        if (streak.length >= 3) return 0.48;
        return 0.42; // bệt ngắn 2 phiên: ưu tiên theo cầu hơn
    }
    if (cauState.type === "dao") {
        // Cầu 1-1: bẻ ở đầu chu kỳ? Thực chất theo opposite, nên không cần bẻ, chỉ theo.
        return 0.20; // rất ít khi bẻ cầu 1-1 (vì nó tự đảo)
    }
    if (cauState.type === "cau2" || cauState.type === "cau3") {
        // Với cầu 2-2, 3-3, sau một nhóm kép, xác suất gãy khoảng 40-50%
        return 0.48;
    }
    // Mặc định
    return 0.45;
}

// -------------------------------------------------------------
// TÍNH TRỌNG SỐ DỰA TRÊN ĐỘ CHÍNH XÁC LỊCH SỬ (EMA)
// -------------------------------------------------------------
function getCauWeight(cauType, baseWeight) {
    let stat = cauAccuracy[cauType];
    if (!stat || stat.total < 3) return baseWeight;
    let acc = stat.correct / stat.total;
    // Exponential Moving Average kết hợp với độ tin cậy hiện tại
    let factor = 0.5 + acc * 1.0;
    factor = Math.min(1.6, Math.max(0.5, factor));
    return baseWeight * factor;
}

// ===============================
// DỰ ĐOÁN CHÍNH - CẢI TIẾN TOÀN DIỆN
// ===============================
function analyze(history) {
    // Trường hợp thiếu dữ liệu giữ nguyên logic cũ
    if (history.length === 0) {
        return { du_doan: "tài", do_tin_cay: "50%", do_tin_cay_so: 50,
                 cau: "Chưa có dữ liệu", chi_tiet: "Mặc định Tài", vote: { tai: 50, xiu: 50 } };
    }
    if (history.length === 1) {
        const only = history[0].ket_qua;
        return { du_doan: only, do_tin_cay: "60%", do_tin_cay_so: 60,
                 cau: `Bệt ${only}`, chi_tiet: "Theo xu hướng duy nhất", vote: { tai: only === "tài" ? 60 : 40, xiu: only === "xỉu" ? 60 : 40 } };
    }
    if (history.length === 2) {
        const r1 = history[0].ket_qua, r2 = history[1].ket_qua;
        const du_doan = r1 === r2 ? r1 : (r1 === "tài" ? "xỉu" : "tài");
        return { du_doan, do_tin_cay: "65%", do_tin_cay_so: 65,
                 cau: r1 === r2 ? `Bệt ${r1} x2` : "Đảo sau 2 phiên",
                 chi_tiet: `${r1}→${r2}`, vote: { tai: du_doan === "tài" ? 65 : 35, xiu: du_doan === "xỉu" ? 65 : 35 } };
    }

    const results = getResultArray(history);
    const cauState = detectCauState(results);
    const breakProb = adaptiveBreakProb(results, cauState);
    const last = results[results.length - 1];

    // Trọng số cơ bản cho từng loại cầu (điều chỉnh qua học thích ứng)
    let w = getCauWeight(cauState.type, 50);
    let finalPrediction = null;
    let confidence = 0;

    // Xử lý theo từng loại cầu
    switch (cauState.type) {
        case "bet":
            // Quyết định bẻ hay theo dựa trên breakProb và độ dài bệt
            if (breakProb > 0.55) {
                finalPrediction = cauState.direction === "tài" ? "xỉu" : "tài";  // bẻ
                confidence = breakProb * 0.9;
            } else {
                finalPrediction = cauState.direction;  // theo
                confidence = (1 - breakProb) * 0.9;
            }
            break;
        case "dao":
        case "cau2":
        case "cau3":
        case "cau121":
        case "cyclic":
            finalPrediction = cauState.direction;
            confidence = cauState.strength;
            break;
        default: // honloan
            // Hỗn loạn: dùng Markov + cân bằng tỉ lệ ngắn hạn
            let markovTai = markovProbability(results);
            let lastTwo = results.slice(-2);
            let shortTrend = (lastTwo[0] === lastTwo[1]) ? lastTwo[0] : (lastTwo[1] === "tài" ? "xỉu" : "tài");
            if (markovTai >= 0.55) finalPrediction = "tài";
            else if (markovTai <= 0.45) finalPrediction = "xỉu";
            else finalPrediction = shortTrend;
            confidence = 0.6;
            break;
    }

    // Tăng cường thêm phân tích cân bằng dài hạn để tránh lệch quá mức
    const ratio = recentRatio(results, 20);
    if (ratio.total > 10 && (ratio.tai / ratio.total > 0.68 || ratio.tai / ratio.total < 0.32)) {
        // Nếu mất cân bằng nghiêm trọng, điều chỉnh nhẹ (10% trọng số)
        let balancePred = ratio.tai / ratio.total > 0.68 ? "xỉu" : "tài";
        if (balancePred !== finalPrediction) {
            // Giảm nhẹ độ tin cậy và cân nhắc
            confidence = confidence * 0.9 + 0.1;
        }
    }

    // Đảm bảo độ tin cậy trong khoảng 55% - 92%
    let confPercent = Math.min(92, Math.max(55, Math.round(confidence * 100)));
    let chiTiet = `${cauState.type.toUpperCase()} (độ mạnh ${Math.round(cauState.strength*100)}%) | Bẻ cầu? ${breakProb>0.55?"Có":"Không"} (xác suất bẻ ${Math.round(breakProb*100)}%)`;

    return {
        du_doan: finalPrediction,
        do_tin_cay: confPercent + "%",
        do_tin_cay_so: confPercent,
        cau: `Cầu ${cauState.type} → ${finalPrediction.toUpperCase()}`,
        chi_tiet: chiTiet,
        vote: { tai: finalPrediction === "tài" ? confPercent : 100 - confPercent, xiu: finalPrediction === "xỉu" ? confPercent : 100 - confPercent }
    };
}

// ===============================
// HỌC THÍCH ỨNG NÂNG CAO (cập nhật độ chính xác theo loại cầu)
// ===============================
function updateLearningFromLastPrediction(newItem) {
    if (predictionLog.length === 0) return;
    const prevPred = predictionLog.find(p => p.phien === newItem.phien);
    if (!prevPred) return;
    const wasCorrect = newItem.ket_qua === prevPred.du_doan;
    // Lấy loại cầu đã dự đoán
    const cauType = prevPred.state;
    if (cauAccuracy[cauType]) {
        cauAccuracy[cauType].total++;
        if (wasCorrect) cauAccuracy[cauType].correct++;
        // Làm mới EMA: chỉ giữ 80% giá trị cũ, 20% mới (ưu tiên gần đây)
        let oldAcc = cauAccuracy[cauType].correct / cauAccuracy[cauType].total;
        let newAcc = wasCorrect ? 1 : 0;
        let ema = oldAcc * EMA_ACCURACY + newAcc * (1 - EMA_ACCURACY);
        // Cập nhật lại (có thể làm trơn)
        cauAccuracy[cauType].correct = ema * cauAccuracy[cauType].total;
    }
}

// ===============================
// CÁC HÀM HỖ TRỢ CŨ (giữ nguyên)
// ===============================
function markovProbability(results, windowSize = 60) {
    const win = results.slice(-windowSize);
    let tt = 0, tx = 0, xt = 0, xx = 0;
    for (let i = 0; i < win.length - 1; i++) {
        const cur = win[i], nxt = win[i + 1];
        if (cur === "tài" && nxt === "tài") tt++;
        else if (cur === "tài" && nxt === "xỉu") tx++;
        else if (cur === "xỉu" && nxt === "tài") xt++;
        else xx++;
    }
    const last = results[results.length - 1];
    if (last === "tài") {
        const t = tt + tx; return t > 0 ? tt / t : 0.5;
    } else {
        const t = xt + xx; return t > 0 ? xt / t : 0.5;
    }
}

function recentRatio(results, window = 12) {
    const win = results.slice(-window);
    const tai = win.filter(r => r === "tài").length;
    return { tai, xiu: win.length - tai, total: win.length };
}

// ===============================
// LẤY DỮ LIỆU API (giữ nguyên)
// ===============================
async function fetchData() {
    try {
        const response = await axios.get(API_URL, { timeout: 10000 });
        const raw = response.data;
        lastRawResponse = raw;
        const d = extractPayload(raw);
        if (!d) {
            console.error("❌ Không tìm được payload.");
            return;
        }
        const phien = d.phien || d.session || d.id || Date.now();
        let dice = null;
        if (d.xuc_xac_1 != null && d.xuc_xac_2 != null && d.xuc_xac_3 != null) {
            dice = [Number(d.xuc_xac_1), Number(d.xuc_xac_2), Number(d.xuc_xac_3)];
        } else if (Array.isArray(d.xuc_xac)) dice = d.xuc_xac.map(Number);
        else if (typeof d.xuc_xac === "string" && d.xuc_xac.includes("-")) dice = d.xuc_xac.split("-").map(Number);
        else if (Array.isArray(d.dice)) dice = d.dice.map(Number);
        else if (d.x1 != null && d.x2 != null && d.x3 != null) dice = [Number(d.x1), Number(d.x2), Number(d.x3)];
        if (!dice || dice.length !== 3 || dice.some(isNaN)) {
            console.error("❌ Không parse được xúc xắc.");
            return;
        }
        const total = dice.reduce((a, b) => a + b, 0);
        let ket_qua = (d.ket_qua || d.result || "").toString().toLowerCase().trim();
        if (ket_qua === "tai" || ket_qua === "t") ket_qua = "tài";
        if (ket_qua === "xiu" || ket_qua === "x") ket_qua = "xỉu";
        if (ket_qua !== "tài" && ket_qua !== "xỉu") ket_qua = getResult(total);
        const item = { phien: Number(phien), ket_qua, xuc_xac: dice.join("-"), tong: total, time: Date.now() };
        const exists = history.find(i => i.phien === item.phien);
        if (!exists) {
            updateLearningFromLastPrediction(item);
            history.push(item);
            if (history.length > 300) history.shift();
            console.log(`✅ Phiên mới: #${item.phien} | ${dice.join("-")} = ${total} → ${ket_qua}`);
        } else {
            console.log(`⏩ Đã có phiên #${phien}`);
        }
    } catch (err) {
        console.error("🔥 API ERROR:", err.message);
    }
}

setInterval(fetchData, 4000);
fetchData();

// ===============================
// ENDPOINTS (giữ nguyên cấu trúc, chỉ cập nhật thông tin dự đoán)
// ===============================
app.get("/", (req, res) => {
    const latest = history[history.length - 1];
    if (!latest) return res.json({ msg: "Đang tải dữ liệu...", debug: lastRawResponse });
    const predict = analyze(history);
    const results = history.map(h => h.ket_qua);
    const streak = getCurrentStreak(results);
    const cauState = detectCauState(results);
    // Lưu prediction
    predictionLog.push({ phien: latest.phien + 1, du_doan: predict.du_doan, state: cauState.type });
    if (predictionLog.length > 200) predictionLog.shift();
    const prevPred = predictionLog.find(p => p.phien === latest.phien);
    const ketQuaDoan = prevPred ? (prevPred.du_doan === latest.ket_qua ? "THẮNG ✅" : "THUA ❌") : "Chưa có";
    const lichSu = history.slice(-20).reverse().map(h => ({ phien: h.phien, ket_qua: h.ket_qua, xuc_xac: h.xuc_xac, tong: h.tong }));
    res.json({
        Id: "Ha Quoc - Cải tiến v5",
        Phien: latest.phien,
        Ket_qua: latest.ket_qua,
        Xuc_xac: latest.xuc_xac,
        Tong: latest.tong,
        Ket_qua_du_doan: ketQuaDoan,
        Phien_tiep: latest.phien + 1,
        Du_doan: predict.du_doan,
        Do_tin_cay: predict.do_tin_cay,
        Cau: predict.cau,
        Chi_tiet: predict.chi_tiet,
        Vote: predict.vote,
        Streak_hien_tai: `${streak.value} x${streak.length}`,
        Thong_ke: { tong_phien: history.length, tai: results.filter(r=>r==="tài").length, xiu: results.filter(r=>r==="xỉu").length },
        Do_chinh_xac_theo_cau: Object.fromEntries(Object.entries(cauAccuracy).map(([k,v])=>[k, v.total>=3 ? (v.correct/v.total*100).toFixed(1)+"%" : "chưa đủ"])),
        Lich_su: lichSu
    });
});

app.get("/predict", (req, res) => {
    if (history.length < 3) return res.json({ msg: "Chưa đủ dữ liệu" });
    const predict = analyze(history);
    const latest = history[history.length-1];
    res.json({ phien_ke: latest.phien+1, du_doan: predict.du_doan, do_tin_cay: predict.do_tin_cay, cau: predict.cau });
});

app.get("/history", (req, res) => {
    const limit = Number(req.query.limit) || 50;
    res.json({ total: history.length, data: history.slice(-limit).reverse() });
});

app.get("/analysis", (req, res) => {
    const results = history.map(h=>h.ket_qua);
    const cauState = detectCauState(results);
    res.json({ loai_cau_hien_tai: cauState, do_chinh_xac_theo_cau: cauAccuracy });
});

app.get("/debug-api", (req, res) => res.json({ lastRawResponse }));

app.listen(PORT, () => console.log(`🚀 SERVER v5 chạy tại cổng ${PORT}`));