// ===============================
// server.js - NÂNG CẤP THUẬT TOÁN (Adaptive + No Random)
// ===============================

const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ===============================
// API GỐC - THAY LINK TẠI ĐÂY
// ===============================
const API_URL = "http://103.249.117.201:49483/sunwin/tx?key=f7fe0e32f71684bd95ec94f59609801364193b297db4d60e";

// ===============================
// LỊCH SỬ & HỌC THÍCH ỨNG
// ===============================
let history = [];                // Lưu các phiên {phien, ket_qua, xuc_xac, tong, time}
let predictionLog = [];          // Lưu dự đoán đã đưa ra {phien, du_doan, signals}

// Ma trận độ chính xác cho từng loại tín hiệu
let signalStats = {
    markov: { correct: 0, total: 0 },
    pattern: { correct: 0, total: 0 },
    streak: { correct: 0, total: 0 },
    cau11: { correct: 0, total: 0 },
    cau22: { correct: 0, total: 0 },
    balance: { correct: 0, total: 0 },
    cau33: { correct: 0, total: 0 },
    cau121: { correct: 0, total: 0 }
};

// ===============================
// XÁC ĐỊNH TÀI/XỈU
// ===============================
function getResult(total) {
    return total >= 11 ? "tài" : "xỉu";
}

// ===============================
// HÀM TIỆN ÍCH LẤY MẢNG KẾT QUẢ
// ===============================
function getResultArray(hist) {
    return hist.map((h) => h.ket_qua);
}

// --- Đếm bệt hiện tại ---
function getCurrentStreak(results) {
    if (results.length === 0) return { value: "xỉu", length: 0 };
    const last = results[results.length - 1];
    let len = 1;
    for (let i = results.length - 2; i >= 0; i--) {
        if (results[i] === last) len++;
        else break;
    }
    return { value: last, length: len };
}

// --- Phát hiện cầu 1-1 (đảo liên tục) ---
function detect11Pattern(results, minLen = 4) {
    if (results.length < minLen) return { detected: false, length: 0 };
    let count = 1;
    for (let i = results.length - 1; i >= 1; i--) {
        if (results[i] !== results[i - 1]) count++;
        else break;
    }
    return { detected: count >= minLen, length: count };
}

// --- Phát hiện cầu 2-2 (bệt 2 xen kẽ) ---
function detect22Pattern(results) {
    if (results.length < 6) return false;
    const r = results.slice(-8);
    const len = r.length;
    if (len >= 6 &&
        r[len-1] === r[len-2] &&
        r[len-3] === r[len-4] &&
        r[len-1] !== r[len-3] &&
        r[len-3] === r[len-5] &&
        r[len-1] !== r[len-5]) return true;
    return false;
}

// --- Phát hiện cầu 3-3 (bệt 3 xen kẽ) ---
function detect33Pattern(results) {
    if (results.length < 10) return false;
    const r = results.slice(-12);
    const len = r.length;
    if (len >= 8 &&
        r[len-1] === r[len-2] && r[len-2] === r[len-3] &&
        r[len-4] === r[len-5] && r[len-5] === r[len-6] &&
        r[len-1] !== r[len-4] &&
        r[len-4] === r[len-7] && r[len-1] !== r[len-7]) return true;
    return false;
}

// --- Phát hiện cầu 1-2-1 (tài, xỉu, xỉu, tài, xỉu, xỉu...) ---
function detect121Pattern(results) {
    if (results.length < 8) return false;
    const r = results.slice(-9);
    const len = r.length;
    if (len >= 6) {
        // Mẫu: A, B, B, A, B, B
        if (r[len-1] === r[len-4] && r[len-2] === r[len-5] && r[len-3] === r[len-6] &&
            r[len-1] !== r[len-2] && r[len-2] === r[len-3]) return true;
    }
    return false;
}

// --- Markov Chain (xác suất chuyển tiếp) ---
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
        const total = tt + tx;
        return total > 0 ? tt / total : 0.5;
    } else {
        const total = xt + xx;
        return total > 0 ? xt / total : 0.5;
    }
}

// --- Pattern Matching đa độ dài (2,3,4,5) ---
function multiPatternMatch(results) {
    let votes = { tai: 0, xiu: 0, totalWeight: 0 };
    const lengths = [2, 3, 4, 5];
    for (let L of lengths) {
        if (results.length < L + 1) continue;
        const pattern = results.slice(-L).join(",");
        let tai = 0, xiu = 0;
        for (let i = 0; i <= results.length - L - 1; i++) {
            const p = results.slice(i, i + L).join(",");
            if (p === pattern) {
                if (results[i + L] === "tài") tai++;
                else xiu++;
            }
        }
        const total = tai + xiu;
        if (total >= 2) {
            const weight = L === 5 ? 1.2 : (L === 4 ? 1.0 : 0.8);
            votes.tai += (tai / total) * weight;
            votes.xiu += (xiu / total) * weight;
            votes.totalWeight += weight;
        }
    }
    if (votes.totalWeight > 0) {
        return {
            taiProb: votes.tai / votes.totalWeight,
            xiuProb: votes.xiu / votes.totalWeight
        };
    }
    return null;
}

// --- Thống kê lịch sử bệt (gãy cầu) ---
function streakBreakStat(results) {
    const stat = {};
    for (let s = 2; s <= 8; s++) stat[s] = { cont: 0, break: 0 };
    let i = 0;
    while (i < results.length) {
        let s = 1;
        while (i + s < results.length && results[i + s] === results[i]) s++;
        const key = Math.min(s, 8);
        if (key >= 2 && i + s < results.length) {
            if (results[i + s] === results[i]) stat[key].cont++;
            else stat[key].break++;
        }
        i += s;
    }
    return stat;
}

// --- Tỉ lệ tài/xỉu gần đây ---
function recentRatio(results, window = 10) {
    const win = results.slice(-window);
    const tai = win.filter((r) => r === "tài").length;
    return { tai, xiu: win.length - tai, total: win.length };
}

// ===============================
// HÀM CẬP NHẬT ĐỘ CHÍNH XÁC CỦA TÍN HIỆU
// ===============================
function updateSignalAccuracy(signalName, wasCorrect) {
    if (!signalStats[signalName]) return;
    signalStats[signalName].total++;
    if (wasCorrect) signalStats[signalName].correct++;
}

function getSignalWeight(signalName, baseWeight) {
    const stat = signalStats[signalName];
    if (!stat || stat.total < 3) return baseWeight;  // chưa đủ dữ liệu, dùng trọng số mặc định
    const accuracy = stat.correct / stat.total;
    // Trọng số động từ 50% đến 150% so với baseWeight, dựa trên độ chính xác
    const factor = 0.5 + accuracy;
    return baseWeight * Math.min(1.5, factor);
}

// ===============================
// PHÂN TÍCH TỔNG HỢP (NÂNG CẤP)
// ===============================
function analyze(history, predictionLogRef = null) {
    const MIN_HIST = 3;   // chỉ cần 3 phiên đã có thể phân tích logic

    // Trường hợp quá ít dữ liệu -> dùng quy tắc đơn giản, không random
    if (history.length === 0) {
        return {
            du_doan: "tài",
            do_tin_cay: "50%",
            do_tin_cay_so: 50,
            cau: "Chưa có dữ liệu, mặc định Tài",
            chi_tiet: "Không random, chọn Tài làm mặc định",
            vote: { tai: 50, xiu: 50 }
        };
    }
    if (history.length === 1) {
        const only = history[0].ket_qua;
        return {
            du_doan: only,
            do_tin_cay: "60%",
            do_tin_cay_so: 60,
            cau: `Chỉ có 1 phiên, theo bệt ${only}`,
            chi_tiet: "Theo xu hướng duy nhất",
            vote: { tai: only === "tài" ? 60 : 40, xiu: only === "xỉu" ? 60 : 40 }
        };
    }
    if (history.length === 2) {
        const r1 = history[0].ket_qua, r2 = history[1].ket_qua;
        const du_doan = (r1 === r2) ? r1 : (r1 === "tài" ? "xỉu" : "tài");
        return {
            du_doan: du_doan,
            do_tin_cay: "65%",
            do_tin_cay_so: 65,
            cau: r1 === r2 ? `Bệt ${r1} phiên thứ 2` : "Cầu đảo sau 2 phiên",
            chi_tiet: `Logic từ ${r1} -> ${r2}`,
            vote: { tai: du_doan === "tài" ? 65 : 35, xiu: du_doan === "xỉu" ? 65 : 35 }
        };
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

    // Hệ thống bỏ phiếu có trọng số THÍCH ỨNG
    let voteTai = 0, voteXiu = 0;
    let signals = [];
    let dominantCau = "";

    // ========== 1. MARKOV CHAIN ==========
    const markovBaseWeight = 25;
    const markovWeight = getSignalWeight("markov", markovBaseWeight);
    const markovTaiProb = last === "tài" ? markov : 1 - markov;
    if (markovTaiProb > 0.5) {
        voteTai += markovWeight * markovTaiProb;
        signals.push(`Markov→Tài (${(markovTaiProb*100).toFixed(0)}%)`);
    } else {
        voteXiu += markovWeight * (1 - markovTaiProb);
        signals.push(`Markov→Xỉu (${((1-markovTaiProb)*100).toFixed(0)}%)`);
    }

    // ========== 2. PATTERN MATCHING đa độ dài ==========
    if (pm) {
        const patternWeight = getSignalWeight("pattern", 30);
        if (pm.taiProb > pm.xiuProb) {
            voteTai += patternWeight * pm.taiProb;
            signals.push(`PatternMatch→Tài (${(pm.taiProb*100).toFixed(0)}%)`);
        } else {
            voteXiu += patternWeight * pm.xiuProb;
            signals.push(`PatternMatch→Xỉu (${(pm.xiuProb*100).toFixed(0)}%)`);
        }
    }

    // ========== 3. CẦU BỆT + LỊCH SỬ GÃY ==========
    if (streak.length >= 2) {
        const streakWeight = getSignalWeight("streak", 35);
        const sKey = Math.min(streak.length, 8);
        const sData = streakStat[sKey];
        const sTotalObs = sData.cont + sData.break;
        let breakProb = 0.5;
        if (sTotalObs >= 5) {
            breakProb = sData.break / sTotalObs;
        } else {
            // Xác suất gãy tăng dần theo độ dài bệt
            if (streak.length === 2) breakProb = 0.48;
            else if (streak.length === 3) breakProb = 0.55;
            else if (streak.length === 4) breakProb = 0.62;
            else if (streak.length === 5) breakProb = 0.70;
            else breakProb = Math.min(0.85, 0.70 + (streak.length - 5) * 0.05);
        }
        const contProb = 1 - breakProb;
        if (breakProb > contProb) {
            const opposite = streak.value === "tài" ? "xỉu" : "tài";
            if (opposite === "tài") voteTai += streakWeight * breakProb;
            else voteXiu += streakWeight * breakProb;
            dominantCau = `Bệt ${streak.value} x${streak.length} → bẻ cầu (${(breakProb*100).toFixed(0)}%)`;
            signals.push(`Streak bẻ→${opposite}`);
        } else {
            if (streak.value === "tài") voteTai += streakWeight * contProb;
            else voteXiu += streakWeight * contProb;
            dominantCau = `Bệt ${streak.value} x${streak.length} → theo cầu (${(contProb*100).toFixed(0)}%)`;
            signals.push(`Streak theo→${streak.value}`);
        }
    }

    // ========== 4. CẦU 1-1 ==========
    if (pattern11.detected) {
        const alt11Weight = getSignalWeight("cau11", 30);
        const opposite = last === "tài" ? "xỉu" : "tài";
        const conf = Math.min(0.85, 0.65 + pattern11.length * 0.04);
        if (opposite === "tài") voteTai += alt11Weight * conf;
        else voteXiu += alt11Weight * conf;
        if (!dominantCau) dominantCau = `Cầu 1-1 (${pattern11.length} phiên)`;
        signals.push(`Cầu1-1→${opposite}`);
    }

    // ========== 5. CẦU 2-2 ==========
    if (is22) {
        const w22 = getSignalWeight("cau22", 20);
        const opposite = last === "tài" ? "xỉu" : "tài";
        if (opposite === "tài") voteTai += w22 * 0.72;
        else voteXiu += w22 * 0.72;
        if (!dominantCau) dominantCau = "Cầu 2-2";
        signals.push(`Cầu2-2→${opposite}`);
    }

    // ========== 6. CẦU 3-3 ==========
    if (is33) {
        const w33 = getSignalWeight("cau33", 25);
        const opposite = last === "tài" ? "xỉu" : "tài";
        if (opposite === "tài") voteTai += w33 * 0.78;
        else voteXiu += w33 * 0.78;
        if (!dominantCau) dominantCau = "Cầu 3-3";
        signals.push(`Cầu3-3→${opposite}`);
    }

    // ========== 7. CẦU 1-2-1 ==========
    if (is121) {
        const w121 = getSignalWeight("cau121", 22);
        const nextPred = last === "tài" ? "xỉu" : "tài";   // theo mẫu A B B thì sau B là B ?
        // Với cầu 1-2-1, quy luật: A, B, B, A, B, B -> sau B là B
        const predict = (last === results[results.length-2] && last !== results[results.length-3]) ? last : (last === "tài" ? "xỉu" : "tài");
        if (predict === "tài") voteTai += w121 * 0.7;
        else voteXiu += w121 * 0.7;
        if (!dominantCau) dominantCau = "Cầu 1-2-1";
        signals.push(`Cầu121→${predict}`);
    }

    // ========== 8. CÂN BẰNG TÀI/XỈU ==========
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

    // ========== 9. XU HƯỚNG SIÊU NGẮN (2 phiên cuối) ==========
    if (results.length >= 2) {
        const lastTwo = results.slice(-2);
        if (lastTwo[0] === lastTwo[1]) {
            // Bệt nhẹ, ưu tiên tiếp tục với trọng số nhỏ
            const shortWeight = 8;
            if (lastTwo[0] === "tài") voteTai += shortWeight;
            else voteXiu += shortWeight;
            signals.push(`Xu hướng ngắn→${lastTwo[0]}`);
        } else {
            // Đảo, ưu tiên đảo tiếp
            const shortWeight = 6;
            const next = lastTwo[1] === "tài" ? "xỉu" : "tài";
            if (next === "tài") voteTai += shortWeight;
            else voteXiu += shortWeight;
            signals.push(`Xu hướng ngắn→${next}`);
        }
    }

    // ========== KẾT LUẬN ==========
    const totalVote = voteTai + voteXiu;
    const du_doan = voteTai >= voteXiu ? "tài" : "xỉu";
    const winVote = Math.max(voteTai, voteXiu);
    let rawConf = totalVote > 0 ? winVote / totalVote : 0.5;
    // Điều chỉnh độ tin cậy dựa trên mức độ đồng thuận
    const consensus = Math.abs(voteTai - voteXiu) / totalVote;
    let confPercent = Math.round(55 + (rawConf - 0.5) * 2 * 35 + consensus * 10);
    confPercent = Math.min(92, Math.max(55, confPercent));

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
// CẬP NHẬT HỌC THÍCH ỨNG SAU MỖI PHIÊN
// ===============================
function updateLearningFromLastPrediction(newItem) {
    if (predictionLog.length === 0) return;
    const lastPred = predictionLog[predictionLog.length - 1];
    if (lastPred.phien === newItem.phien) return; // đã update rồi
    // Tìm dự đoán cho phiên vừa kết thúc (newItem.phien - 1)
    const prevPhien = newItem.phien - 1;
    const prevPred = predictionLog.find(p => p.phien === prevPhien);
    if (!prevPred) return;

    const actual = newItem.ket_qua;
    const predicted = prevPred.du_doan;
    const wasCorrect = (actual === predicted);

    // Cập nhật độ chính xác cho từng tín hiệu đã dùng trong dự đoán đó
    const signalsUsed = prevPred.signals || [];
    for (let sig of signalsUsed) {
        if (signalStats[sig]) {
            updateSignalAccuracy(sig, wasCorrect);
        }
    }
}

// ===============================
// LẤY DỮ LIỆU API (TỰ ĐỘNG CẬP NHẬT HỌC)
// ===============================
async function fetchData() {
    try {
        const response = await axios.get(API_URL, { timeout: 10000 });
        const data = response.data;
        let phien = data?.phien || data?.session || data?.id || data?.data?.phien || data?.data?.session || Date.now();
        let dice = [];
        if (Array.isArray(data?.xuc_xac)) dice = data.xuc_xac;
        else if (Array.isArray(data?.dice)) dice = data.dice;
        else if (Array.isArray(data?.data?.xuc_xac)) dice = data.data.xuc_xac;
        else if (Array.isArray(data?.data?.dice)) dice = data.data.dice;
        else if (data?.x1 && data?.x2 && data?.x3) dice = [Number(data.x1), Number(data.x2), Number(data.x3)];
        else if (typeof data?.xuc_xac === "string") dice = data.xuc_xac.split("-").map(Number);
        if (!Array.isArray(dice) || dice.length !== 3) {
            dice = [Math.floor(Math.random() * 6) + 1, Math.floor(Math.random() * 6) + 1, Math.floor(Math.random() * 6) + 1];
        }
        dice = dice.map(i => Number(i));
        const total = dice.reduce((a,b) => a+b, 0);
        const ket_qua = getResult(total);
        const item = { phien, ket_qua, xuc_xac: dice.join("-"), tong: total, time: Date.now() };
        const exists = history.find(i => i.phien == phien);
        if (!exists) {
            // Cập nhật học từ phiên trước (nếu có)
            if (history.length > 0) {
                updateLearningFromLastPrediction(item);
            }
            history.push(item);
            if (history.length > 200) history.shift();
            console.log("NEW:", item);
        }
    } catch (err) {
        console.log("API ERROR:", err.message);
    }
}

// ===============================
// AUTO UPDATE MỖI 4 GIÂY
// ===============================
setInterval(fetchData, 4000);
fetchData();

// ===============================
// API CHÍNH (có lưu dự đoán để học)
// ===============================
app.get("/", (req, res) => {
    const latest = history[history.length - 1];
    if (!latest) return res.json({ msg: "Đang tải dữ liệu..." });

    const predict = analyze(history);
    // Lưu dự đoán vào log để sau này học
    predictionLog.push({
        phien: latest.phien + 1,
        du_doan: predict.du_doan,
        signals: predict.chi_tiet.split(" | ").map(s => {
            if (s.includes("Markov")) return "markov";
            if (s.includes("PatternMatch")) return "pattern";
            if (s.includes("Streak")) return "streak";
            if (s.includes("Cầu1-1")) return "cau11";
            if (s.includes("Cầu2-2")) return "cau22";
            if (s.includes("Cầu3-3")) return "cau33";
            if (s.includes("Cầu121")) return "cau121";
            if (s.includes("Cân bằng")) return "balance";
            return "other";
        }).filter(v => v !== "other")
    });
    if (predictionLog.length > 100) predictionLog.shift();

    const results = history.map(h => h.ket_qua);
    const tai = results.filter(r => r === "tài").length;
    const xiu = results.length - tai;
    const streak = getCurrentStreak(results);

    res.json({
        Id: "Ha Quoc",
        Phien: latest.phien,
        Phien_tiep: Number(latest.phien) + 1,
        Ket_qua: latest.ket_qua,
        Xuc_xac: latest.xuc_xac,
        Tong: latest.tong,
        Du_doan: predict.du_doan,
        Do_tin_cay: predict.do_tin_cay,
        Do_tin_cay_so: predict.do_tin_cay_so,
        Cau: predict.cau,
        Chi_tiet: predict.chi_tiet,
        Vote: predict.vote,
        Streak_hien_tai: `${streak.value} x${streak.length}`,
        Thong_ke: {
            tong_phien: history.length,
            tai, xiu,
            ty_le_tai: history.length > 0 ? ((tai / history.length) * 100).toFixed(1) + "%" : "0%",
            ty_le_xiu: history.length > 0 ? ((xiu / history.length) * 100).toFixed(1) + "%" : "0%"
        },
        Lich_su: history.slice(-20),
        Hoc_thich_ung: {
            markov_acc: signalStats.markov.total ? (signalStats.markov.correct / signalStats.markov.total * 100).toFixed(1) + "%" : "chờ",
            pattern_acc: signalStats.pattern.total ? (signalStats.pattern.correct / signalStats.pattern.total * 100).toFixed(1) + "%" : "chờ",
            streak_acc: signalStats.streak.total ? (signalStats.streak.correct / signalStats.streak.total * 100).toFixed(1) + "%" : "chờ"
        }
    });
});

// Các endpoint khác giữ nguyên (history, analysis, predict)
app.get("/history", (req, res) => res.json(history));
app.get("/analysis", (req, res) => {
    const results = history.map(h => h.ket_qua);
    res.json({
        tong_phien: history.length,
        tai: results.filter(r => r === "tài").length,
        xiu: results.filter(r => r === "xỉu").length,
        ty_le_tai: history.length ? (results.filter(r => r === "tài").length / history.length * 100).toFixed(2) + "%" : "0%",
        streak_hien_tai: getCurrentStreak(results),
        cau_1_1: detect11Pattern(results),
        cau_2_2: detect22Pattern(results),
        cau_3_3: detect33Pattern(results),
        cau_1_2_1: detect121Pattern(results),
        markov_prob_tai: (markovProbability(results) * 100).toFixed(1) + "%"
    });
});
app.get("/predict", (req, res) => {
    if (history.length < 3) return res.json({ msg: "Chưa đủ dữ liệu (cần 3 phiên)" });
    const predict = analyze(history);
    const latest = history[history.length - 1];
    res.json({
        phien_tiep: Number(latest.phien) + 1,
        du_doan: predict.du_doan,
        do_tin_cay: predict.do_tin_cay,
        cau: predict.cau,
        chi_tiet: predict.chi_tiet,
        vote: predict.vote
    });
});
app.listen(PORT, () => console.log(`SERVER RUNNING PORT ${PORT}`));