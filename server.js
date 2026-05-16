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
let history = [];        // [{phien, ket_qua, xuc_xac, tong, time}]
let predictionLog = [];  // [{phien, du_doan, cauType, thuc_te?, dung?}]

// Độ chính xác EMA theo từng loại cầu
let cauAccuracy = {
    bet_theo:   { correct: 0, total: 0, ema: 0.65 },   // bệt - theo
    bet_be:     { correct: 0, total: 0, ema: 0.60 },   // bệt - bẻ
    dao:        { correct: 0, total: 0, ema: 0.65 },   // 1-1
    cau2:       { correct: 0, total: 0, ema: 0.65 },   // 2-2
    cau3:       { correct: 0, total: 0, ema: 0.65 },   // 3-3
    cau121:     { correct: 0, total: 0, ema: 0.60 },   // 1-2-1
    cyclic:     { correct: 0, total: 0, ema: 0.60 },   // chu kỳ
    honloan:    { correct: 0, total: 0, ema: 0.55 },   // hỗn loạn
};

const EMA_ALPHA = 0.25; // Hệ số ema: 0.25 = ưu tiên 25% kết quả mới nhất
let lastRawResponse = null;

// ===============================
// TIỆN ÍCH
// ===============================
function getResult(total) { return total >= 11 ? "tài" : "xỉu"; }
function opposite(v) { return v === "tài" ? "xỉu" : "tài"; }
function getResultArray(hist) { return hist.map(h => h.ket_qua); }

// ===============================
// MODULE 1: PHÂN TÍCH CẦU BỆT (Streak)
// ===============================

/**
 * Trả về streak hiện tại và thông tin momentum
 */
function analyzeStreak(results) {
    if (!results.length) return { value: "tài", length: 0, momentum: 0, isFading: false };
    const last = results[results.length - 1];
    let len = 1;
    for (let i = results.length - 2; i >= 0; i--) {
        if (results[i] === last) len++;
        else break;
    }
    // Phân tích momentum: so sánh tần suất giá trị này trong 20 phiên gần đây vs 10 phiên xa hơn
    const recent10 = results.slice(-10);
    const prev10 = results.slice(-20, -10);
    const freqRecent = recent10.filter(r => r === last).length / Math.max(recent10.length, 1);
    const freqPrev   = prev10.length > 0 ? prev10.filter(r => r === last).length / prev10.length : 0.5;
    const momentum   = freqRecent - freqPrev; // dương = đang tăng, âm = đang giảm
    const isFading   = momentum < -0.15 && len >= 3; // cầu bệt đang suy yếu

    return { value: last, length: len, momentum, isFading };
}

/**
 * Đánh giá ngưỡng bẻ bệt thông minh
 * Trả về { shouldBreak: bool, confidence: 0..1, reason: string }
 */
function evaluateStreakBreak(results, streak) {
    const len = streak.length;
    const val = streak.value;

    // --- Tín hiệu 1: Xác suất bẻ theo độ dài bệt (thống kê thực nghiệm TX) ---
    // Bệt dài càng dễ bẻ, nhưng bệt siêu dài đôi khi tiếp tục
    let breakProb;
    if      (len >= 10) breakProb = 0.82;
    else if (len >= 8)  breakProb = 0.75;
    else if (len >= 6)  breakProb = 0.68;
    else if (len >= 5)  breakProb = 0.60;
    else if (len >= 4)  breakProb = 0.52;
    else if (len === 3) breakProb = 0.44;
    else                breakProb = 0.35; // bệt 2: quá sớm để bẻ

    // --- Tín hiệu 2: Markov transition ---
    const markov = markovProbability(results);
    const markovBreakSignal = val === "tài" ? (1 - markov) : markov;
    // markovBreakSignal cao = Markov nghiêng về phía ngược lại

    // --- Tín hiệu 3: Tỉ lệ gần đây (15 phiên) ---
    const ratio15 = recentRatio(results, 15);
    let imbalance = 0;
    if (ratio15.total > 5) {
        const dominance = ratio15[val === "tài" ? "tai" : "xiu"] / ratio15.total;
        imbalance = Math.max(0, dominance - 0.6); // bắt đầu tính nếu > 60%
    }

    // --- Tín hiệu 4: Entropy ngắn hạn (chuỗi bệt có entropy thấp = sắp bẻ?) ---
    const ent = shannonEntropy(results.slice(-12));
    // Entropy thấp (< 0.6) = quá đồng nhất, khả năng bẻ tăng
    const entropySignal = Math.max(0, 0.9 - ent);

    // --- Tín hiệu 5: Momentum cầu ---
    const momentumPenalty = streak.isFading ? 0.12 : 0; // cầu đang mờ dần -> dễ bẻ hơn

    // --- Tổng hợp điểm bẻ cầu (weighted average) ---
    const breakScore = (
        breakProb       * 0.40 +
        markovBreakSignal * 0.25 +
        imbalance       * 0.20 +
        entropySignal   * 0.10 +
        momentumPenalty * 0.05
    );

    const shouldBreak = breakScore > 0.52;
    const reasons = [];
    if (len >= 5) reasons.push(`bệt dài ${len}`);
    if (markovBreakSignal > 0.6) reasons.push(`Markov ngược ${(markovBreakSignal*100).toFixed(0)}%`);
    if (imbalance > 0.05) reasons.push(`mất cân bằng`);
    if (streak.isFading) reasons.push(`momentum giảm`);

    return {
        shouldBreak,
        breakScore,
        confidence: shouldBreak ? breakScore : (1 - breakScore),
        reason: reasons.join(", ") || "theo cầu"
    };
}

// ===============================
// MODULE 2: PHÁT HIỆN CẦU ĐẢO / NHỊP
// ===============================

/**
 * Phát hiện cầu 1-1 (đảo liên tục) và đánh giá chất lượng
 */
function detect11Pattern(results) {
    const r = results.slice(-16);
    const L = r.length;
    if (L < 4) return { detected: false, length: 0, quality: 0 };
    let alternateLen = 1;
    for (let i = L - 1; i >= 1; i--) {
        if (r[i] !== r[i - 1]) alternateLen++;
        else break;
    }
    if (alternateLen < 4) return { detected: false, length: alternateLen, quality: 0 };
    // Chất lượng: kiểm tra bao nhiêu phiên gần đây đúng kiểu đảo
    let correct = 0;
    const checkLen = Math.min(alternateLen, 10);
    for (let i = L - 1; i >= L - checkLen; i--) {
        if (i >= 1 && r[i] !== r[i - 1]) correct++;
    }
    const quality = correct / (checkLen - 1);
    return { detected: true, length: alternateLen, quality };
}

/**
 * Phát hiện cầu 2-2 (nhóm đôi xen kẽ)
 */
function detect22Pattern(results) {
    const r = results.slice(-14);
    const L = r.length;
    if (L < 6) return { detected: false, quality: 0, groupCount: 0 };
    // Đếm số nhóm đôi liên tiếp
    let groupCount = 0, i = L - 1;
    let expectVal = null;
    while (i >= 1) {
        if (r[i] === r[i - 1]) {
            const grpVal = r[i];
            if (expectVal !== null && grpVal === expectVal) break; // sai nhịp
            expectVal = opposite(grpVal);
            groupCount++;
            i -= 2;
        } else break;
    }
    if (groupCount < 2) return { detected: false, quality: 0, groupCount };
    const quality = Math.min(1, groupCount / 4);
    return { detected: true, quality, groupCount };
}

/**
 * Phát hiện cầu 3-3 (nhóm ba xen kẽ)
 */
function detect33Pattern(results) {
    const r = results.slice(-18);
    const L = r.length;
    if (L < 6) return { detected: false, quality: 0, groupCount: 0 };
    let groupCount = 0, i = L - 1;
    let expectVal = null;
    while (i >= 2) {
        if (r[i] === r[i - 1] && r[i - 1] === r[i - 2]) {
            const grpVal = r[i];
            if (expectVal !== null && grpVal === expectVal) break;
            expectVal = opposite(grpVal);
            groupCount++;
            i -= 3;
        } else break;
    }
    if (groupCount < 2) return { detected: false, quality: 0, groupCount };
    const quality = Math.min(1, groupCount / 3);
    return { detected: true, quality, groupCount };
}

/**
 * Phát hiện cầu 1-2-1 (T X X T hoặc X T T X lặp lại)
 */
function detect121Pattern(results) {
    const r = results.slice(-12);
    const L = r.length;
    if (L < 6) return { detected: false, quality: 0 };
    // Kiểm tra pattern 4-phiên: A B B A hoặc A B B (tiếp theo A)
    let matchCount = 0, checkCount = 0;
    for (let i = L - 1; i >= 3; i -= 4) {
        if (r[i] === r[i-3] && r[i-1] === r[i-2] && r[i] !== r[i-1]) matchCount++;
        checkCount++;
    }
    if (checkCount === 0 || matchCount / checkCount < 0.5) return { detected: false, quality: 0 };
    return { detected: true, quality: matchCount / checkCount };
}

/**
 * Phát hiện chu kỳ lặp (period 2..6)
 */
function detectCyclicPattern(results) {
    const win = results.slice(-36);
    const L = win.length;
    if (L < 8) return null;
    let best = null;
    for (let period = 2; period <= 6; period++) {
        if (L < period * 3) continue;
        let matches = 0, total = 0;
        for (let i = period; i < L; i++) {
            if (win[i] === win[i - period]) matches++;
            total++;
        }
        if (total === 0) continue;
        const acc = matches / total;
        if (acc >= 0.80 && (!best || acc > best.acc)) {
            // Dự đoán phiên tiếp: lấy phần tử tại vị trí (L % period) trước đó
            const posInCycle = L % period;
            const refIdx = L - period + posInCycle;
            const predicted = refIdx >= 0 ? win[refIdx] : win[L - 1];
            best = { period, acc, predicted };
        }
    }
    if (!best) return null;
    return { detected: true, period: best.period, confidence: best.acc, predicted: best.predicted };
}

// ===============================
// MODULE 3: PHÂN TÍCH HỖN LOẠN (Entropy + Markov)
// ===============================

/**
 * Shannon Entropy của chuỗi (0 = đồng nhất hoàn toàn, 1 = ngẫu nhiên hoàn toàn)
 */
function shannonEntropy(results) {
    if (!results.length) return 1;
    const tai = results.filter(r => r === "tài").length;
    const xiu = results.length - tai;
    const pt = tai / results.length;
    const px = xiu / results.length;
    const ent = -(pt > 0 ? pt * Math.log2(pt) : 0) - (px > 0 ? px * Math.log2(px) : 0);
    return ent; // max = 1 khi pt=px=0.5
}

/**
 * Xác suất Markov: P(tài | state hiện tại)
 */
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
    if (last === "tài") { const t = tt + tx; return t > 0 ? tt / t : 0.5; }
    else                { const t = xt + xx; return t > 0 ? xt / t : 0.5; }
}

/**
 * Tỉ lệ tài/xỉu trong cửa sổ gần đây
 */
function recentRatio(results, window = 15) {
    const win = results.slice(-window);
    const tai = win.filter(r => r === "tài").length;
    return { tai, xiu: win.length - tai, total: win.length };
}

// ===============================
// MODULE 4: NHẬN DIỆN TRẠNG THÁI CẦU TỔNG HỢP
// ===============================

function detectCauState(results) {
    const streak = analyzeStreak(results);
    const p11  = detect11Pattern(results);
    const p22  = detect22Pattern(results);
    const p33  = detect33Pattern(results);
    const p121 = detect121Pattern(results);
    const cyc  = detectCyclicPattern(results);

    // --- Ưu tiên bệt dài (>=3) ---
    if (streak.length >= 3) {
        return {
            type: "bet",
            strength: Math.min(0.92, 0.50 + streak.length * 0.06),
            direction: streak.value,
            streak,
            meta: { streakLen: streak.length, momentum: streak.momentum }
        };
    }

    // --- Cầu 3-3 (ưu tiên cao vì pattern mạnh) ---
    if (p33.detected && p33.quality >= 0.6) {
        const last = results[results.length - 1];
        // Xem đang ở vị trí nào trong nhóm 3
        const grpPos = (results.length % 3);
        const direction = grpPos === 0 ? opposite(last) : last;
        return { type: "cau3", strength: 0.70 + p33.quality * 0.20, direction, meta: p33 };
    }

    // --- Cầu 2-2 ---
    if (p22.detected && p22.quality >= 0.5) {
        const last = results[results.length - 1];
        const prev = results[results.length - 2];
        // Nếu 2 phiên gần nhất giống nhau -> chuẩn bị đổi
        const direction = last === prev ? opposite(last) : last;
        return { type: "cau2", strength: 0.65 + p22.quality * 0.20, direction, meta: p22 };
    }

    // --- Cầu 1-1 ---
    if (p11.detected && p11.length >= 4) {
        const last = results[results.length - 1];
        return { type: "dao", strength: 0.60 + p11.quality * 0.25, direction: opposite(last), meta: p11 };
    }

    // --- Cầu 1-2-1 ---
    if (p121.detected) {
        const last = results[results.length - 1];
        const prev = results[results.length - 2];
        // Nếu 2 phiên cuối giống nhau -> đổi; ngược lại -> giữ
        const direction = last === prev ? opposite(last) : last;
        return { type: "cau121", strength: 0.55 + p121.quality * 0.20, direction, meta: p121 };
    }

    // --- Chu kỳ ---
    if (cyc && cyc.detected && cyc.confidence >= 0.82) {
        return { type: "cyclic", strength: cyc.confidence * 0.88, direction: cyc.predicted, meta: cyc };
    }

    // --- Không rõ cầu ---
    return { type: "honloan", strength: 0.50, direction: null, streak, meta: {} };
}

// ===============================
// MODULE 5: HỆ THỐNG VOTING ĐA TÍN HIỆU
// ===============================

/**
 * Mỗi "voter" trả về { vote: "tài"|"xỉu", weight: số, label: string }
 * Tổng hợp lại bằng weighted sum.
 */
function multiSignalVote(results, cauState) {
    const last = results[results.length - 1];
    const streak = cauState.streak || analyzeStreak(results);
    const voters = [];

    // ---- Voter 1: Cầu chính (loại cầu nhận diện được) ----
    if (cauState.direction) {
        let w = 0;
        switch (cauState.type) {
            case "bet":    w = 2.5; break;
            case "dao":    w = 2.2; break;
            case "cau3":   w = 2.5; break;
            case "cau2":   w = 2.0; break;
            case "cau121": w = 1.6; break;
            case "cyclic": w = 2.0; break;
        }
        // Điều chỉnh theo EMA accuracy
        const accKey = cauState.type === "bet" ? "bet_theo" : cauState.type;
        if (cauAccuracy[accKey] && cauAccuracy[accKey].total >= 3) {
            const ema = cauAccuracy[accKey].ema;
            w *= (0.5 + ema); // ema 0.5 -> w*1.0; ema 0.8 -> w*1.3
        }
        voters.push({ vote: cauState.direction, weight: w * cauState.strength, label: `cau_${cauState.type}` });
    }

    // ---- Voter 2: Markov chain ----
    const markovTai = markovProbability(results);
    const markovVote = markovTai >= 0.5 ? "tài" : "xỉu";
    const markovConf = Math.abs(markovTai - 0.5) * 2; // 0..1
    voters.push({ vote: markovVote, weight: 1.2 * markovConf, label: "markov" });

    // ---- Voter 3: Cân bằng tỉ lệ ngắn hạn (15 phiên) ----
    const ratio15 = recentRatio(results, 15);
    if (ratio15.total >= 8) {
        const taiRatio = ratio15.tai / ratio15.total;
        if (taiRatio > 0.60) voters.push({ vote: "xỉu", weight: (taiRatio - 0.60) * 3.0, label: "balance_15" });
        else if (taiRatio < 0.40) voters.push({ vote: "tài", weight: (0.40 - taiRatio) * 3.0, label: "balance_15" });
    }

    // ---- Voter 4: Cân bằng tỉ lệ trung hạn (30 phiên) ----
    const ratio30 = recentRatio(results, 30);
    if (ratio30.total >= 15) {
        const taiRatio = ratio30.tai / ratio30.total;
        if (taiRatio > 0.62) voters.push({ vote: "xỉu", weight: (taiRatio - 0.62) * 2.0, label: "balance_30" });
        else if (taiRatio < 0.38) voters.push({ vote: "tài", weight: (0.38 - taiRatio) * 2.0, label: "balance_30" });
    }

    // ---- Voter 5: Entropy (chuỗi hỗn loạn -> giảm tin vào cầu) ----
    const ent = shannonEntropy(results.slice(-12));
    // Nếu entropy cao -> không thêm signal mạnh từ cầu (đã xử lý qua weight bên trên)

    // ---- Voter 6: Pattern 2 phiên cuối (micro-trend) ----
    if (results.length >= 2) {
        const r1 = results[results.length - 1];
        const r2 = results[results.length - 2];
        if (r1 === r2) {
            // Đang bệt ngắn: micro-vote theo cầu
            voters.push({ vote: r1, weight: 0.4, label: "micro_streak" });
        } else {
            // Đang đảo: micro-vote ngược lại
            voters.push({ vote: opposite(r1), weight: 0.3, label: "micro_alt" });
        }
    }

    // ---- Voter 7: Bẻ cầu bệt (chỉ áp dụng khi đang bệt) ----
    if (cauState.type === "bet" && streak.length >= 3) {
        const breakEval = evaluateStreakBreak(results, streak);
        if (breakEval.shouldBreak) {
            const breakDir = opposite(streak.value);
            // Weight bẻ: mạnh hơn khi breakScore cao và có EMA accuracy của bet_be tốt
            let bw = breakEval.breakScore * 2.0;
            if (cauAccuracy.bet_be.total >= 3) bw *= (0.5 + cauAccuracy.bet_be.ema);
            voters.push({ vote: breakDir, weight: bw, label: `be_cau(${breakEval.reason})` });
        }
    }

    // ---- Tổng hợp weighted vote ----
    let scoreTai = 0, scoreXiu = 0;
    for (const v of voters) {
        if (v.weight <= 0) continue;
        if (v.vote === "tài") scoreTai += v.weight;
        else scoreXiu += v.weight;
    }

    const total = scoreTai + scoreXiu;
    const taiProb = total > 0 ? scoreTai / total : 0.5;
    const finalVote = taiProb >= 0.5 ? "tài" : "xỉu";
    const rawConfidence = Math.abs(taiProb - 0.5) * 2; // 0..1

    return {
        prediction: finalVote,
        taiProb,
        rawConfidence,
        voters,
        scoreTai,
        scoreXiu
    };
}

// ===============================
// MODULE 6: QUYẾT ĐỊNH CUỐI CÙNG
// ===============================
function analyze(history) {
    if (history.length === 0) {
        return buildResult("tài", 50, "honloan", "Chưa có dữ liệu", "Mặc định Tài", "—");
    }
    if (history.length === 1) {
        const only = history[0].ket_qua;
        return buildResult(only, 58, "bet", `Bệt ${only}`, "Theo xu hướng duy nhất", "—");
    }
    if (history.length === 2) {
        const r1 = history[0].ket_qua, r2 = history[1].ket_qua;
        const du_doan = r1 === r2 ? r1 : opposite(r2);
        return buildResult(du_doan, 60, "bet", r1 === r2 ? `Bệt ${r1} x2` : "Đảo 2 phiên", `${r1}→${r2}`, "—");
    }

    const results = getResultArray(history);
    const cauState = detectCauState(results);
    const streak   = cauState.streak || analyzeStreak(results);
    const vote     = multiSignalVote(results, cauState);

    const finalPrediction = vote.prediction;

    // Tính confidence dựa trên: độ mạnh cầu + raw confidence từ voting
    let confBase = vote.rawConfidence * 0.5 + cauState.strength * 0.3 + 0.2;
    // Điều chỉnh entropy: chuỗi hỗn loạn -> giảm confidence
    const ent = shannonEntropy(results.slice(-15));
    confBase *= (1 - ent * 0.15);

    const confPercent = Math.min(91, Math.max(54, Math.round(confBase * 100)));

    // Xác định chiến lược: "theo cầu" hay "bẻ cầu"
    let strategy = "theo_cau";
    if (cauState.type === "bet" && streak.length >= 3) {
        const breakEval = evaluateStreakBreak(results, streak);
        if (breakEval.shouldBreak && finalPrediction !== streak.value) {
            strategy = "be_cau";
        }
    }

    // Key để cập nhật accuracy
    const accKey = cauState.type === "bet"
        ? (strategy === "be_cau" ? "bet_be" : "bet_theo")
        : cauState.type;

    // Mô tả chi tiết
    const breakInfo = cauState.type === "bet" && streak.length >= 3
        ? evaluateStreakBreak(results, streak)
        : null;
    const chiTiet = buildChiTiet(cauState, streak, vote, strategy, breakInfo);

    // Cầu mô tả
    let cauLabel = "";
    switch (cauState.type) {
        case "bet":    cauLabel = `Bệt ${streak.value} x${streak.length}`; break;
        case "dao":    cauLabel = `Cầu 1-1 (${streak.length} phiên đảo)`; break;
        case "cau2":   cauLabel = `Cầu 2-2 (${cauState.meta?.groupCount || "?"} nhóm)`; break;
        case "cau3":   cauLabel = `Cầu 3-3 (${cauState.meta?.groupCount || "?"} nhóm)`; break;
        case "cau121": cauLabel = `Cầu 1-2-1`; break;
        case "cyclic": cauLabel = `Chu kỳ period=${cauState.meta?.period}`; break;
        default:       cauLabel = "Hỗn loạn";
    }

    return buildResult(finalPrediction, confPercent, accKey, cauLabel, chiTiet, strategy, vote);
}

function buildResult(prediction, confPercent, accKey, cauLabel, chiTiet, strategy, vote = null) {
    return {
        du_doan: prediction,
        do_tin_cay: confPercent + "%",
        do_tin_cay_so: confPercent,
        cau: cauLabel,
        chi_tiet: chiTiet,
        chien_luoc: strategy,
        vote: {
            tai: prediction === "tài" ? confPercent : 100 - confPercent,
            xiu: prediction === "xỉu" ? confPercent : 100 - confPercent
        },
        _accKey: accKey,
        _voters: vote ? vote.voters.map(v => `${v.label}(${v.vote},${v.weight.toFixed(2)})`).join(" | ") : ""
    };
}

function buildChiTiet(cauState, streak, vote, strategy, breakInfo) {
    const parts = [];
    parts.push(`Cầu: ${cauState.type.toUpperCase()} (mạnh ${Math.round(cauState.strength * 100)}%)`);
    if (cauState.type === "bet") {
        parts.push(`Bệt ${streak.value} x${streak.length}`);
        if (streak.isFading) parts.push("⚠️ momentum giảm");
        if (breakInfo) {
            parts.push(strategy === "be_cau"
                ? `🔴 BẺ CẦU (score=${Math.round(breakInfo.breakScore * 100)}% | ${breakInfo.reason})`
                : `🟢 THEO CẦU (score bẻ thấp ${Math.round(breakInfo.breakScore * 100)}%)`);
        }
    }
    parts.push(`Tài/Xỉu vote: ${vote.scoreTai.toFixed(2)} vs ${vote.scoreXiu.toFixed(2)}`);
    parts.push(`Markov P(tài)=${Math.round(vote.taiProb * 100)}%`);
    return parts.join(" | ");
}

// ===============================
// HỌC THÍCH ỨNG EMA
// ===============================
function updateLearning(newItem) {
    if (predictionLog.length === 0) return;
    const pred = predictionLog.findLast(p => p.phien === newItem.phien);
    if (!pred) return;
    const wasCorrect = newItem.ket_qua === pred.du_doan;
    const key = pred.accKey;
    if (!cauAccuracy[key]) return;
    cauAccuracy[key].total++;
    if (wasCorrect) cauAccuracy[key].correct++;
    // EMA update
    const outcome = wasCorrect ? 1 : 0;
    cauAccuracy[key].ema = cauAccuracy[key].ema * (1 - EMA_ALPHA) + outcome * EMA_ALPHA;
    console.log(`📊 Học: phiên ${newItem.phien} | ${key} | ${wasCorrect ? "✅" : "❌"} | EMA=${cauAccuracy[key].ema.toFixed(3)}`);
}

// ===============================
// LẤY DỮ LIỆU API
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

async function fetchData() {
    try {
        const response = await axios.get(API_URL, { timeout: 10000 });
        const raw = response.data;
        lastRawResponse = raw;
        const d = extractPayload(raw);
        if (!d) { console.error("❌ Không tìm được payload."); return; }

        const phien = d.phien || d.session || d.id || Date.now();
        let dice = null;
        if (d.xuc_xac_1 != null && d.xuc_xac_2 != null && d.xuc_xac_3 != null)
            dice = [Number(d.xuc_xac_1), Number(d.xuc_xac_2), Number(d.xuc_xac_3)];
        else if (Array.isArray(d.xuc_xac)) dice = d.xuc_xac.map(Number);
        else if (typeof d.xuc_xac === "string" && d.xuc_xac.includes("-")) dice = d.xuc_xac.split("-").map(Number);
        else if (Array.isArray(d.dice)) dice = d.dice.map(Number);
        else if (d.x1 != null && d.x2 != null && d.x3 != null) dice = [Number(d.x1), Number(d.x2), Number(d.x3)];

        if (!dice || dice.length !== 3 || dice.some(isNaN)) { console.error("❌ Không parse được xúc xắc."); return; }

        const total = dice.reduce((a, b) => a + b, 0);
        let ket_qua = (d.ket_qua || d.result || "").toString().toLowerCase().trim();
        if (ket_qua === "tai" || ket_qua === "t") ket_qua = "tài";
        if (ket_qua === "xiu" || ket_qua === "x") ket_qua = "xỉu";
        if (ket_qua !== "tài" && ket_qua !== "xỉu") ket_qua = getResult(total);

        const item = { phien: Number(phien), ket_qua, xuc_xac: dice.join("-"), tong: total, time: Date.now() };
        const exists = history.find(i => i.phien === item.phien);
        if (!exists) {
            updateLearning(item);
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
// ENDPOINTS
// ===============================
app.get("/", (req, res) => {
    const latest = history[history.length - 1];
    if (!latest) return res.json({ msg: "Đang tải dữ liệu...", debug: lastRawResponse });

    const predict = analyze(history);
    const results = history.map(h => h.ket_qua);
    const streak  = analyzeStreak(results);
    const cauState = detectCauState(results);

    // Lưu prediction cho phiên kế tiếp
    predictionLog.push({
        phien: latest.phien + 1,
        du_doan: predict.du_doan,
        accKey: predict._accKey,
        cauType: cauState.type
    });
    if (predictionLog.length > 200) predictionLog.shift();

    const prevPred = predictionLog.findLast(p => p.phien === latest.phien);
    const ketQuaDoan = prevPred
        ? (prevPred.du_doan === latest.ket_qua ? "THẮNG ✅" : "THUA ❌")
        : "Chưa có";

    const lichSu = history.slice(-20).reverse().map(h => ({
        phien: h.phien, ket_qua: h.ket_qua, xuc_xac: h.xuc_xac, tong: h.tong
    }));

    // Thống kê accuracy tổng hợp
    const totalPred = predictionLog.length;
    let correctCount = 0;
    for (const p of predictionLog) {
        const actual = history.find(h => h.phien === p.phien);
        if (actual && actual.ket_qua === p.du_doan) correctCount++;
    }

    res.json({
        Id: "Ha Quoc - v6 Multi-Signal",
        Phien: latest.phien,
        Ket_qua: latest.ket_qua,
        Xuc_xac: latest.xuc_xac,
        Tong: latest.tong,
        Ket_qua_du_doan: ketQuaDoan,
        Phien_tiep: latest.phien + 1,
        Du_doan: predict.du_doan,
        Do_tin_cay: predict.do_tin_cay,
        Chien_luoc: predict.chien_luoc,
        Cau: predict.cau,
        Chi_tiet: predict.chi_tiet,
        Vote: predict.vote,
        Voters: predict._voters,
        Streak_hien_tai: `${streak.value} x${streak.length} (momentum ${streak.momentum >= 0 ? "+" : ""}${streak.momentum.toFixed(2)})`,
        Thong_ke: {
            tong_phien: history.length,
            tai: results.filter(r => r === "tài").length,
            xiu: results.filter(r => r === "xỉu").length,
            do_chinh_xac_tong: totalPred > 0 ? (correctCount / totalPred * 100).toFixed(1) + "%" : "chưa đủ"
        },
        Do_chinh_xac_theo_cau: Object.fromEntries(
            Object.entries(cauAccuracy).map(([k, v]) => [
                k,
                v.total >= 3
                    ? `${(v.correct / v.total * 100).toFixed(1)}% (EMA: ${(v.ema * 100).toFixed(1)}%)`
                    : "chưa đủ"
            ])
        ),
        Lich_su: lichSu
    });
});

app.get("/predict", (req, res) => {
    if (history.length < 3) return res.json({ msg: "Chưa đủ dữ liệu" });
    const predict = analyze(history);
    const latest = history[history.length - 1];
    res.json({
        phien_ke: latest.phien + 1,
        du_doan: predict.du_doan,
        do_tin_cay: predict.do_tin_cay,
        chien_luoc: predict.chien_luoc,
        cau: predict.cau,
        chi_tiet: predict.chi_tiet,
        vote: predict.vote
    });
});

app.get("/history", (req, res) => {
    const limit = Number(req.query.limit) || 50;
    res.json({ total: history.length, data: history.slice(-limit).reverse() });
});

app.get("/analysis", (req, res) => {
    const results = history.map(h => h.ket_qua);
    const cauState = detectCauState(results);
    const streak   = analyzeStreak(results);
    const ent      = shannonEntropy(results.slice(-20));
    const p11      = detect11Pattern(results);
    const p22      = detect22Pattern(results);
    const p33      = detect33Pattern(results);
    const cyc      = detectCyclicPattern(results);
    res.json({
        loai_cau: cauState,
        streak,
        entropy_20: ent.toFixed(3),
        patterns: { p11, p22, p33, cyclic: cyc },
        do_chinh_xac_theo_cau: cauAccuracy
    });
});

app.get("/debug-api", (req, res) => res.json({ lastRawResponse }));

app.listen(PORT, () => console.log(`🚀 SERVER v6 Multi-Signal chạy tại cổng ${PORT}`));
