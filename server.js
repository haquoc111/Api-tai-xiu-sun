// ===============================
// server.js v3.0 - FIX API + THUẬT TOÁN BÁM CẦU / BẺ CẦU NÂNG CAO
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
// LỊCH SỬ & HỌC THÍCH ỨNG
// ===============================
let history = [];           // [{phien, ket_qua, xuc_xac, tong, time}]
let predictionLog = [];     // [{phien, du_doan, signals}]
let lastRawResponse = null;

let signalStats = {
    markov:  { correct: 0, total: 0 },
    pattern: { correct: 0, total: 0 },
    streak:  { correct: 0, total: 0 },
    cau11:   { correct: 0, total: 0 },
    cau22:   { correct: 0, total: 0 },
    cau33:   { correct: 0, total: 0 },
    cau121:  { correct: 0, total: 0 },
    balance: { correct: 0, total: 0 }
};

// ===============================
// PARSE API - HỖ TRỢ NHIỀU CẤU TRÚC LỒNG NHAU
// ===============================
/**
 * API có thể trả về nhiều dạng:
 *   { ket_qua, phien, tong, xuc_xac_1, xuc_xac_2, xuc_xac_3 }          ← cấp 1
 *   { data: { ket_qua, phien, ... } }                                     ← lồng .data
 *   { msg, debug: { success, data: { ket_qua, phien, ... } } }           ← lồng .debug.data  ← ẢNH CHỤP
 *   { success, data: { ... } }                                             ← lồng .data
 */
function extractPayload(raw) {
    if (!raw) return null;

    // Thứ tự ưu tiên từ ảnh chụp: msg + debug.data
    const candidates = [
        raw,
        raw?.data,
        raw?.debug?.data,
        raw?.result,
        raw?.response
    ];

    for (const c of candidates) {
        if (!c || typeof c !== "object") continue;
        // Đủ trường thì dùng
        if (c.phien && (c.xuc_xac_1 || c.xuc_xac || c.dice || c.tong)) return c;
    }
    return null;
}

// ===============================
// LOGIC TÀI / XỈU
// ===============================
function getResult(total) {
    return total >= 11 ? "tài" : "xỉu";
}
function getResultArray(hist) {
    return hist.map(h => h.ket_qua);
}

// ===============================
// PHÂN TÍCH CẦU
// ===============================

// Đếm bệt hiện tại
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

// Cầu 1-1 (xen kẽ liên tục)
function detect11Pattern(results, minLen = 4) {
    if (results.length < minLen) return { detected: false, length: 0 };
    let count = 1;
    for (let i = results.length - 1; i >= 1; i--) {
        if (results[i] !== results[i - 1]) count++;
        else break;
    }
    return { detected: count >= minLen, length: count };
}

// Cầu 2-2 (TTXX hoặc XXTT lặp)
function detect22Pattern(results) {
    if (results.length < 6) return false;
    const r = results.slice(-8);
    const L = r.length;
    if (L >= 6 &&
        r[L-1] === r[L-2] &&
        r[L-3] === r[L-4] &&
        r[L-1] !== r[L-3] &&
        r[L-3] === r[L-5] &&
        r[L-1] !== r[L-5]) return true;
    return false;
}

// Cầu 3-3
function detect33Pattern(results) {
    if (results.length < 8) return false;
    const r = results.slice(-12);
    const L = r.length;
    if (L >= 8 &&
        r[L-1] === r[L-2] && r[L-2] === r[L-3] &&
        r[L-4] === r[L-5] && r[L-5] === r[L-6] &&
        r[L-1] !== r[L-4] &&
        r[L-4] === r[L-7] && r[L-1] !== r[L-7]) return true;
    return false;
}

// Cầu 1-2-1
function detect121Pattern(results) {
    if (results.length < 6) return false;
    const r = results.slice(-9);
    const L = r.length;
    if (L >= 6) {
        if (r[L-1] === r[L-4] && r[L-2] === r[L-5] && r[L-3] === r[L-6] &&
            r[L-1] !== r[L-2] && r[L-2] === r[L-3]) return true;
    }
    return false;
}

// Cầu bệt dài (4+)
function detectLongStreak(results, minLen = 4) {
    const streak = getCurrentStreak(results);
    return streak.length >= minLen ? streak : null;
}

// Markov Chain xác suất
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

// Pattern matching đa độ dài
function multiPatternMatch(results) {
    let votes = { tai: 0, xiu: 0, totalWeight: 0 };
    for (let L of [2, 3, 4, 5]) {
        if (results.length < L + 1) continue;
        const pattern = results.slice(-L).join(",");
        let tai = 0, xiu = 0;
        for (let i = 0; i <= results.length - L - 1; i++) {
            if (results.slice(i, i + L).join(",") === pattern) {
                if (results[i + L] === "tài") tai++;
                else xiu++;
            }
        }
        const total = tai + xiu;
        if (total >= 2) {
            const weight = L === 5 ? 1.2 : L === 4 ? 1.0 : 0.8;
            votes.tai += (tai / total) * weight;
            votes.xiu += (xiu / total) * weight;
            votes.totalWeight += weight;
        }
    }
    if (votes.totalWeight > 0) {
        return { taiProb: votes.tai / votes.totalWeight, xiuProb: votes.xiu / votes.totalWeight };
    }
    return null;
}

// Thống kê lịch sử gãy bệt
function streakBreakStat(results) {
    const stat = {};
    for (let s = 2; s <= 10; s++) stat[s] = { cont: 0, break: 0 };
    let i = 0;
    while (i < results.length) {
        let s = 1;
        while (i + s < results.length && results[i + s] === results[i]) s++;
        const key = Math.min(s, 10);
        if (key >= 2 && i + s < results.length) {
            if (results[i + s] === results[i]) stat[key].cont++;
            else stat[key].break++;
        }
        i += s;
    }
    return stat;
}

// Tỉ lệ gần đây
function recentRatio(results, window = 12) {
    const win = results.slice(-window);
    const tai = win.filter(r => r === "tài").length;
    return { tai, xiu: win.length - tai, total: win.length };
}

// ===============================
// HỌC THÍCH ỨNG
// ===============================
function updateSignalAccuracy(signalName, wasCorrect) {
    if (!signalStats[signalName]) return;
    signalStats[signalName].total++;
    if (wasCorrect) signalStats[signalName].correct++;
}

function getSignalWeight(signalName, baseWeight) {
    const stat = signalStats[signalName];
    if (!stat || stat.total < 5) return baseWeight;
    const accuracy = stat.correct / stat.total;
    // Tín hiệu chính xác cao → tăng trọng số, thấp → giảm
    const factor = 0.4 + accuracy * 1.2;
    return baseWeight * Math.min(1.6, Math.max(0.4, factor));
}

// ===============================
// THUẬT TOÁN DỰ ĐOÁN CHÍNH
// ===============================
function analyze(history) {
    // --- Không đủ dữ liệu ---
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
    const streak = getCurrentStreak(results);
    const pattern11 = detect11Pattern(results);
    const is22 = detect22Pattern(results);
    const is33 = detect33Pattern(results);
    const is121 = detect121Pattern(results);
    const markov = markovProbability(results);
    const pm = multiPatternMatch(results);
    const streakStat = streakBreakStat(results);
    const ratio = recentRatio(results, 12);
    const last = results[results.length - 1];

    let voteTai = 0, voteXiu = 0;
    let signals = [];
    let dominantCau = "";

    // ── 1. Markov Chain ──────────────────────────────────────
    const markovWeight = getSignalWeight("markov", 25);
    const markovTaiProb = last === "tài" ? markov : 1 - markov;
    if (markovTaiProb >= 0.5) {
        voteTai += markovWeight * markovTaiProb;
        signals.push(`Markov→Tài(${(markovTaiProb*100).toFixed(0)}%)`);
    } else {
        voteXiu += markovWeight * (1 - markovTaiProb);
        signals.push(`Markov→Xỉu(${((1-markovTaiProb)*100).toFixed(0)}%)`);
    }

    // ── 2. Pattern Matching ───────────────────────────────────
    if (pm) {
        const patternWeight = getSignalWeight("pattern", 30);
        if (pm.taiProb >= pm.xiuProb) {
            voteTai += patternWeight * pm.taiProb;
            signals.push(`PatternMatch→Tài(${(pm.taiProb*100).toFixed(0)}%)`);
        } else {
            voteXiu += patternWeight * pm.xiuProb;
            signals.push(`PatternMatch→Xỉu(${(pm.xiuProb*100).toFixed(0)}%)`);
        }
    }

    // ── 3. Phân tích bệt + lịch sử gãy ──────────────────────
    if (streak.length >= 2) {
        const streakWeight = getSignalWeight("streak", 40);
        const sKey = Math.min(streak.length, 10);
        const sData = streakStat[sKey];
        const obs = sData.cont + sData.break;

        // Xác suất gãy từ lịch sử, nếu chưa đủ dùng prior
        let breakProb;
        if (obs >= 5) {
            breakProb = sData.break / obs;
        } else {
            // Prior: bệt càng dài càng dễ gãy
            const priors = { 2: 0.47, 3: 0.52, 4: 0.60, 5: 0.68, 6: 0.75, 7: 0.80, 8: 0.84, 9: 0.87, 10: 0.90 };
            breakProb = priors[Math.min(sKey, 10)] || 0.90;
            // Pha trộn với lịch sử nếu có ít data
            if (obs > 0) breakProb = (breakProb * (5 - obs) + (sData.break / obs) * obs) / 5;
        }
        const contProb = 1 - breakProb;

        if (breakProb > contProb) {
            const opposite = streak.value === "tài" ? "xỉu" : "tài";
            if (opposite === "tài") voteTai += streakWeight * breakProb;
            else voteXiu += streakWeight * breakProb;
            dominantCau = `Bệt ${streak.value} x${streak.length} → BẺ CẦU (${(breakProb*100).toFixed(0)}%)`;
            signals.push(`Streak bẻ→${opposite}`);
        } else {
            if (streak.value === "tài") voteTai += streakWeight * contProb;
            else voteXiu += streakWeight * contProb;
            dominantCau = `Bệt ${streak.value} x${streak.length} → theo cầu (${(contProb*100).toFixed(0)}%)`;
            signals.push(`Streak theo→${streak.value}`);
        }
    }

    // ── 4. Cầu 1-1 ───────────────────────────────────────────
    if (pattern11.detected) {
        const w = getSignalWeight("cau11", 32);
        const opposite = last === "tài" ? "xỉu" : "tài";
        const conf = Math.min(0.88, 0.65 + pattern11.length * 0.04);
        if (opposite === "tài") voteTai += w * conf;
        else voteXiu += w * conf;
        if (!dominantCau) dominantCau = `Cầu 1-1 (${pattern11.length} phiên)`;
        signals.push(`Cầu1-1→${opposite}`);
    }

    // ── 5. Cầu 2-2 ───────────────────────────────────────────
    if (is22) {
        const w = getSignalWeight("cau22", 22);
        // Trong cầu 2-2: tiếp theo là đảo sang nhóm kia
        const opposite = last === "tài" ? "xỉu" : "tài";
        if (opposite === "tài") voteTai += w * 0.72;
        else voteXiu += w * 0.72;
        if (!dominantCau) dominantCau = "Cầu 2-2";
        signals.push(`Cầu2-2→${opposite}`);
    }

    // ── 6. Cầu 3-3 ───────────────────────────────────────────
    if (is33) {
        const w = getSignalWeight("cau33", 26);
        const opposite = last === "tài" ? "xỉu" : "tài";
        if (opposite === "tài") voteTai += w * 0.78;
        else voteXiu += w * 0.78;
        if (!dominantCau) dominantCau = "Cầu 3-3";
        signals.push(`Cầu3-3→${opposite}`);
    }

    // ── 7. Cầu 1-2-1 ─────────────────────────────────────────
    if (is121) {
        const w = getSignalWeight("cau121", 22);
        const r = results;
        const predict = (r[r.length-1] === r[r.length-2] && r[r.length-1] !== r[r.length-3])
            ? (r[r.length-1] === "tài" ? "xỉu" : "tài")
            : r[r.length-1];
        if (predict === "tài") voteTai += w * 0.70;
        else voteXiu += w * 0.70;
        if (!dominantCau) dominantCau = "Cầu 1-2-1";
        signals.push(`Cầu121→${predict}`);
    }

    // ── 8. Cân bằng tỉ lệ ────────────────────────────────────
    const balanceWeight = getSignalWeight("balance", 12);
    if (ratio.total > 0) {
        const ratioTai = ratio.tai / ratio.total;
        if (ratioTai > 0.65) {
            voteXiu += balanceWeight;
            signals.push("Cân bằng→Xỉu");
        } else if (ratioTai < 0.35) {
            voteTai += balanceWeight;
            signals.push("Cân bằng→Tài");
        }
    }

    // ── 9. Xu hướng siêu ngắn (2 phiên gần nhất) ─────────────
    if (results.length >= 2) {
        const lastTwo = results.slice(-2);
        const shortW = 8;
        if (lastTwo[0] === lastTwo[1]) {
            // Bệt ngắn: theo cầu
            if (lastTwo[0] === "tài") voteTai += shortW;
            else voteXiu += shortW;
            signals.push(`Short→${lastTwo[0]}`);
        } else {
            // Đảo: dự theo chiều tiếp theo
            const next = lastTwo[1] === "tài" ? "xỉu" : "tài";
            if (next === "tài") voteTai += shortW;
            else voteXiu += shortW;
            signals.push(`Short→${next}`);
        }
    }

    // ── Tổng hợp ─────────────────────────────────────────────
    const totalVote = voteTai + voteXiu;
    const du_doan = voteTai >= voteXiu ? "tài" : "xỉu";
    const winVote = Math.max(voteTai, voteXiu);
    const rawConf = totalVote > 0 ? winVote / totalVote : 0.5;
    const consensus = Math.abs(voteTai - voteXiu) / (totalVote || 1);
    let confPercent = Math.round(55 + (rawConf - 0.5) * 2 * 35 + consensus * 10);
    confPercent = Math.min(93, Math.max(55, confPercent));

    if (!dominantCau) {
        dominantCau = du_doan === "tài" ? "Tổng hợp → Tài" : "Tổng hợp → Xỉu";
    }

    return {
        du_doan,
        do_tin_cay: confPercent + "%",
        do_tin_cay_so: confPercent,
        cau: dominantCau,
        chi_tiet: signals.join(" | "),
        vote: { tai: Math.round(voteTai), xiu: Math.round(voteXiu) }
    };
}

// ===============================
// CẬP NHẬT HỌC THÍCH ỨNG
// ===============================
function updateLearningFromLastPrediction(newItem) {
    if (predictionLog.length === 0) return;
    const prevPred = predictionLog.find(p => p.phien === newItem.phien);
    if (!prevPred) return;
    const wasCorrect = newItem.ket_qua === prevPred.du_doan;
    for (const sig of prevPred.signals) {
        if (signalStats[sig]) updateSignalAccuracy(sig, wasCorrect);
    }
}

// ===============================
// LẤY DỮ LIỆU API - FIX PARSE ĐA CẤU TRÚC
// ===============================
async function fetchData() {
    try {
        const response = await axios.get(API_URL, { timeout: 10000 });
        const raw = response.data;
        lastRawResponse = raw;

        // ── Extract payload từ cấu trúc lồng nhau ──
        const d = extractPayload(raw);
        if (!d) {
            console.error("❌ Không tìm được payload. Raw:", JSON.stringify(raw).slice(0, 300));
            return;
        }

        // ── Parse phiên ──
        const phien = d.phien || d.session || d.id || Date.now();

        // ── Parse xúc xắc ──
        let dice = null;
        if (d.xuc_xac_1 != null && d.xuc_xac_2 != null && d.xuc_xac_3 != null) {
            dice = [Number(d.xuc_xac_1), Number(d.xuc_xac_2), Number(d.xuc_xac_3)];
        } else if (Array.isArray(d.xuc_xac)) {
            dice = d.xuc_xac.map(Number);
        } else if (typeof d.xuc_xac === "string" && d.xuc_xac.includes("-")) {
            dice = d.xuc_xac.split("-").map(Number);
        } else if (Array.isArray(d.dice)) {
            dice = d.dice.map(Number);
        } else if (d.x1 != null && d.x2 != null && d.x3 != null) {
            dice = [Number(d.x1), Number(d.x2), Number(d.x3)];
        }

        if (!dice || dice.length !== 3 || dice.some(isNaN)) {
            console.error("❌ Không parse được xúc xắc. Payload:", JSON.stringify(d));
            return;
        }

        const total = dice.reduce((a, b) => a + b, 0);

        // ── Parse kết quả (ưu tiên từ API, fallback tính từ tổng) ──
        let ket_qua = (d.ket_qua || d.result || "").toString().toLowerCase().trim();
        // Chuẩn hóa "tai"/"xiu" không dấu về có dấu
        if (ket_qua === "tai" || ket_qua === "t") ket_qua = "tài";
        if (ket_qua === "xiu" || ket_qua === "x") ket_qua = "xỉu";
        if (ket_qua !== "tài" && ket_qua !== "xỉu") ket_qua = getResult(total);

        // ── Thêm vào lịch sử ──
        const item = {
            phien: Number(phien),
            ket_qua,
            xuc_xac: dice.join("-"),
            tong: total,
            time: Date.now()
        };

        const exists = history.find(i => i.phien === item.phien);
        if (!exists) {
            // Cập nhật học thích ứng trước khi thêm
            updateLearningFromLastPrediction(item);
            history.push(item);
            if (history.length > 300) history.shift();
            console.log(`✅ Phiên mới: #${item.phien} | ${dice.join("-")} = ${total} → ${ket_qua}`);
        } else {
            console.log(`⏩ Đã có phiên #${phien}`);
        }
    } catch (err) {
        console.error("🔥 API ERROR:", err.message);
        if (err.response) console.error("Status:", err.response.status);
    }
}

// Poll mỗi 4 giây
setInterval(fetchData, 4000);
fetchData();

// ===============================
// ENDPOINTS
// ===============================

// Root: dự đoán + lịch sử
app.get("/", (req, res) => {
    const latest = history[history.length - 1];
    if (!latest) {
        return res.json({ msg: "Đang tải dữ liệu...", debug: lastRawResponse });
    }

    const predict = analyze(history);

    // Lưu prediction để sau học
    const signalKeys = predict.chi_tiet.split(" | ").map(s => {
        if (s.includes("Markov")) return "markov";
        if (s.includes("Pattern")) return "pattern";
        if (s.includes("Streak")) return "streak";
        if (s.includes("Cầu1-1")) return "cau11";
        if (s.includes("Cầu2-2")) return "cau22";
        if (s.includes("Cầu3-3")) return "cau33";
        if (s.includes("Cầu121")) return "cau121";
        if (s.includes("Cân bằng")) return "balance";
        return null;
    }).filter(Boolean);

    predictionLog.push({ phien: latest.phien + 1, du_doan: predict.du_doan, signals: signalKeys });
    if (predictionLog.length > 200) predictionLog.shift();

    const results = history.map(h => h.ket_qua);
    const tai = results.filter(r => r === "tài").length;
    const xiu = results.length - tai;
    const streak = getCurrentStreak(results);
    const n = history.length;

    // Lịch sử 20 phiên gần nhất, kèm thông tin đầy đủ
    const lich_su = history.slice(-20).reverse().map(h => ({
        phien: h.phien,
        ket_qua: h.ket_qua,
        xuc_xac: h.xuc_xac,
        tong: h.tong
    }));

    res.json({
        // ── Thông tin phiên hiện tại ──
        phien_hien_tai: latest.phien,
        ket_qua_hien_tai: latest.ket_qua,
        xuc_xac: latest.xuc_xac,
        tong: latest.tong,

        // ── Dự đoán phiên kế ──
        phien_ke: latest.phien + 1,
        du_doan: predict.du_doan.toUpperCase(),
        do_tin_cay: predict.do_tin_cay,
        do_tin_cay_so: predict.do_tin_cay_so,
        cau_phan_tich: predict.cau,
        chi_tiet_tin_hieu: predict.chi_tiet,
        vote: predict.vote,

        // ── Trạng thái cầu ──
        streak_hien_tai: `${streak.value.toUpperCase()} x${streak.length}`,

        // ── Thống kê ──
        thong_ke: {
            tong_phien: n,
            tai, xiu,
            ty_le_tai: n ? ((tai / n) * 100).toFixed(1) + "%" : "0%",
            ty_le_xiu: n ? ((xiu / n) * 100).toFixed(1) + "%" : "0%"
        },

        // ── Độ chính xác tín hiệu (học thích ứng) ──
        do_chinh_xac_tin_hieu: Object.fromEntries(
            Object.entries(signalStats).map(([k, v]) => [
                k,
                v.total >= 3 ? (v.correct / v.total * 100).toFixed(1) + "%" : "chưa đủ data"
            ])
        ),

        // ── Lịch sử 20 phiên ──
        lich_su_20_phien: lich_su
    });
});

// Chỉ lấy dự đoán
app.get("/predict", (req, res) => {
    if (history.length < 3) {
        return res.json({ msg: "Chưa đủ dữ liệu (cần ≥ 3 phiên)" });
    }
    const predict = analyze(history);
    const latest = history[history.length - 1];
    const streak = getCurrentStreak(history.map(h => h.ket_qua));
    res.json({
        phien_ke: Number(latest.phien) + 1,
        du_doan: predict.du_doan.toUpperCase(),
        do_tin_cay: predict.do_tin_cay,
        do_tin_cay_so: predict.do_tin_cay_so,
        cau: predict.cau,
        chi_tiet: predict.chi_tiet,
        vote: predict.vote,
        streak: `${streak.value} x${streak.length}`
    });
});

// Toàn bộ lịch sử
app.get("/history", (req, res) => {
    const limit = Number(req.query.limit) || 50;
    res.json({
        total: history.length,
        data: history.slice(-limit).reverse()
    });
});

// Phân tích cầu chi tiết
app.get("/analysis", (req, res) => {
    const results = history.map(h => h.ket_qua);
    const n = results.length;
    const tai = results.filter(r => r === "tài").length;
    const streak = getCurrentStreak(results);
    const pattern11 = detect11Pattern(results);
    const streakStat = streakBreakStat(results);

    // Xác suất gãy ở bệt hiện tại
    let breakChance = null;
    if (streak.length >= 2) {
        const key = Math.min(streak.length, 10);
        const s = streakStat[key];
        const obs = s.cont + s.break;
        if (obs >= 3) breakChance = (s.break / obs * 100).toFixed(1) + "%";
    }

    res.json({
        tong_phien: n,
        tai, xiu: n - tai,
        ty_le_tai: n ? (tai / n * 100).toFixed(2) + "%" : "0%",
        streak_hien_tai: { value: streak.value, length: streak.length },
        xac_suat_gay_cau_hien_tai: breakChance || "Chưa đủ data",
        cau_1_1: { detected: pattern11.detected, length: pattern11.length },
        cau_2_2: detect22Pattern(results),
        cau_3_3: detect33Pattern(results),
        cau_1_2_1: detect121Pattern(results),
        markov_prob_tai: (markovProbability(results) * 100).toFixed(1) + "%",
        lich_su_gay_bet: Object.fromEntries(
            Object.entries(streakStat).map(([k, v]) => [
                `bet_${k}`,
                { tiep: v.cont, gay: v.break, total: v.cont + v.break,
                  ty_le_gay: (v.cont + v.break) > 0 ? (v.break / (v.cont + v.break) * 100).toFixed(1) + "%" : "0%" }
            ])
        ),
        do_chinh_xac_tin_hieu: Object.fromEntries(
            Object.entries(signalStats).map(([k, v]) => [k,
                v.total >= 3 ? (v.correct / v.total * 100).toFixed(1) + "% (" + v.total + " lần)" : "chưa đủ data"
            ])
        )
    });
});

// Debug raw API
app.get("/debug-api", (req, res) => res.json({ lastRawResponse }));

// ===============================
app.listen(PORT, () => console.log(`🚀 SERVER chạy tại cổng ${PORT}`));
