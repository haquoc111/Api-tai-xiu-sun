// ===============================
// server.js - NÂNG CẤP THUẬT TOÁN
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
// LỊCH SỬ
// ===============================
let history = [];

// ===============================
// XÁC ĐỊNH TÀI/XỈU
// ===============================
function getResult(total) {
  return total >= 11 ? "tài" : "xỉu";
}

// ===============================
// THUẬT TOÁN NÂNG CẤP
// ===============================

// --- Lấy mảng kết quả string ---
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

// --- Phát hiện cầu 1-1 liên tiếp ---
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
  if (
    r[len-1] === r[len-2] &&
    r[len-3] === r[len-4] &&
    r[len-1] !== r[len-3] &&
    r[len-3] === r[len-5] &&
    r[len-1] !== r[len-5]
  ) return true;
  return false;
}

// --- Markov Chain: xác suất chuyển tiếp ---
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

// --- Pattern Matching: tìm chuỗi 4-5 phiên cuối trong lịch sử ---
function patternMatch(results, patLen = 4) {
  if (results.length < patLen + 2) return { tai: 0, xiu: 0, total: 0 };
  const pattern = results.slice(-patLen).join(",");
  let tai = 0, xiu = 0;
  for (let i = 0; i <= results.length - patLen - 1; i++) {
    const p = results.slice(i, i + patLen).join(",");
    if (p === pattern) {
      if (results[i + patLen] === "tài") tai++;
      else xiu++;
    }
  }
  return { tai, xiu, total: tai + xiu };
}

// --- Thống kê lịch sử bệt: sau N bệt liên tiếp thì xảy ra gì ---
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
// HÀM PHÂN TÍCH TỔNG HỢP
// ===============================
function analyze(history) {
  const MIN_HIST = 5;

  if (history.length < MIN_HIST) {
    return {
      du_doan: Math.random() > 0.5 ? "tài" : "xỉu",
      do_tin_cay: "52%",
      do_tin_cay_so: 52,
      cau: "Chưa đủ dữ liệu",
      chi_tiet: "Cần ít nhất 5 phiên để phân tích",
    };
  }

  const results = getResultArray(history);
  const streak = getCurrentStreak(results);
  const pattern11 = detect11Pattern(results);
  const is22 = detect22Pattern(results);
  const markov = markovProbability(results);
  const pm4 = patternMatch(results, 4);
  const pm3 = patternMatch(results, 3);
  const streakStat = streakBreakStat(results);
  const ratio = recentRatio(results, 10);
  const last = results[results.length - 1];

  // Hệ thống bỏ phiếu có trọng số
  let voteTai = 0;
  let voteXiu = 0;
  let signals = [];
  let dominantCau = "";

  // ============================
  // SIGNAL 1: MARKOV CHAIN (w=25)
  // ============================
  const markovW = 25;
  const markovTaiProb = last === "tài" ? markov : 1 - markov;
  if (markovTaiProb > 0.5) {
    voteTai += markovW * markovTaiProb;
    signals.push(`Markov→Tài (${(markovTaiProb * 100).toFixed(0)}%)`);
  } else {
    voteXiu += markovW * (1 - markovTaiProb);
    signals.push(`Markov→Xỉu (${((1 - markovTaiProb) * 100).toFixed(0)}%)`);
  }

  // ============================
  // SIGNAL 2: PATTERN MATCHING (w=30)
  // ============================
  const pmW = 30;
  const pmData = pm4.total >= 3 ? pm4 : pm3;
  if (pmData.total >= 2) {
    const pmTaiProb = pmData.tai / pmData.total;
    if (pmTaiProb > 0.5) {
      voteTai += pmW * pmTaiProb;
      signals.push(`PatternMatch→Tài (${pmData.tai}/${pmData.total})`);
    } else {
      voteXiu += pmW * (1 - pmTaiProb);
      signals.push(`PatternMatch→Xỉu (${pmData.xiu}/${pmData.total})`);
    }
  }

  // ============================
  // SIGNAL 3: CẦU BỆT + LỊCH SỬ GÃY CẦU (w=35)
  // ============================
  const streakW = 35;
  if (streak.length >= 2) {
    const sKey = Math.min(streak.length, 8);
    const sData = streakStat[sKey];
    const sTotalObs = sData.cont + sData.break;

    let breakProb = 0.5;
    if (sTotalObs >= 5) {
      breakProb = sData.break / sTotalObs;
    } else {
      // Mặc định: bệt dài càng cao xác suất gãy
      if (streak.length === 2) breakProb = 0.48;
      else if (streak.length === 3) breakProb = 0.55;
      else if (streak.length === 4) breakProb = 0.62;
      else if (streak.length === 5) breakProb = 0.70;
      else breakProb = Math.min(0.85, 0.70 + (streak.length - 5) * 0.05);
    }

    const contProb = 1 - breakProb;

    // Nếu xác suất gãy > tiếp tục → dự đoán đổi
    if (breakProb > contProb) {
      const opposite = streak.value === "tài" ? "xỉu" : "tài";
      if (opposite === "tài") voteTai += streakW * breakProb;
      else voteXiu += streakW * breakProb;
      dominantCau = `Bệt ${streak.value} ${streak.length} → bẻ cầu (lịch sử gãy: ${(breakProb * 100).toFixed(0)}%)`;
      signals.push(`Streak bẻ→${opposite}`);
    } else {
      // Tiếp tục cầu
      if (streak.value === "tài") voteTai += streakW * contProb;
      else voteXiu += streakW * contProb;
      dominantCau = `Bệt ${streak.value} ${streak.length} → theo cầu (lịch sử tiếp: ${(contProb * 100).toFixed(0)}%)`;
      signals.push(`Streak theo→${streak.value}`);
    }
  }

  // ============================
  // SIGNAL 4: CẦU 1-1 (w=30)
  // ============================
  const alt11W = 30;
  if (pattern11.detected) {
    const opposite = last === "tài" ? "xỉu" : "tài";
    const conf = Math.min(0.85, 0.65 + pattern11.length * 0.04);
    if (opposite === "tài") voteTai += alt11W * conf;
    else voteXiu += alt11W * conf;
    if (!dominantCau) dominantCau = `Cầu 1-1 (${pattern11.length} phiên)`;
    signals.push(`Cầu1-1→${opposite}`);
  }

  // ============================
  // SIGNAL 5: CẦU 2-2 (w=20)
  // ============================
  if (is22) {
    const opposite = last === "tài" ? "xỉu" : "tài";
    if (opposite === "tài") voteTai += 20 * 0.72;
    else voteXiu += 20 * 0.72;
    if (!dominantCau) dominantCau = "Cầu 2-2";
    signals.push(`Cầu2-2→${opposite}`);
  }

  // ============================
  // SIGNAL 6: CÂN BẰNG TÀI/XỈU (w=10)
  // ============================
  const balW = 10;
  if (ratio.total > 0) {
    const ratioTai = ratio.tai / ratio.total;
    if (ratioTai > 0.65) {
      voteXiu += balW;
      signals.push("Cân bằng→Xỉu");
    } else if (ratioTai < 0.35) {
      voteTai += balW;
      signals.push("Cân bằng→Tài");
    }
  }

  // ============================
  // KẾT LUẬN
  // ============================
  const totalVote = voteTai + voteXiu;
  const du_doan = voteTai >= voteXiu ? "tài" : "xỉu";
  const winVote = Math.max(voteTai, voteXiu);
  const rawConf = totalVote > 0 ? winVote / totalVote : 0.5;

  // Scale độ tin cậy về khoảng [55%, 90%]
  const confPercent = Math.round(55 + (rawConf - 0.5) * 2 * 35);
  const clampedConf = Math.min(90, Math.max(55, confPercent));

  if (!dominantCau) {
    dominantCau = du_doan === "tài" ? "Xỉu nhiều → Tài" : "Tài nhiều → Xỉu";
  }

  return {
    du_doan,
    do_tin_cay: clampedConf + "%",
    do_tin_cay_so: clampedConf,
    cau: dominantCau,
    chi_tiet: signals.join(" | "),
    vote: { tai: Math.round(voteTai), xiu: Math.round(voteXiu) },
  };
}

// ===============================
// LẤY DỮ LIỆU API
// ===============================
async function fetchData() {
  try {
    const response = await axios.get(API_URL, { timeout: 10000 });
    const data = response.data;

    console.log("DATA API:", JSON.stringify(data));

    const phien =
      data?.phien ||
      data?.session ||
      data?.id ||
      data?.data?.phien ||
      data?.data?.session ||
      Date.now();

    let dice = [];
    if (Array.isArray(data?.xuc_xac)) dice = data.xuc_xac;
    else if (Array.isArray(data?.dice)) dice = data.dice;
    else if (Array.isArray(data?.data?.xuc_xac)) dice = data.data.xuc_xac;
    else if (Array.isArray(data?.data?.dice)) dice = data.data.dice;
    else if (data?.x1 && data?.x2 && data?.x3)
      dice = [Number(data.x1), Number(data.x2), Number(data.x3)];
    else if (typeof data?.xuc_xac === "string")
      dice = data.xuc_xac.split("-").map(Number);

    if (!Array.isArray(dice) || dice.length !== 3) {
      dice = [
        Math.floor(Math.random() * 6) + 1,
        Math.floor(Math.random() * 6) + 1,
        Math.floor(Math.random() * 6) + 1,
      ];
    }

    dice = dice.map((i) => Number(i));
    const total = dice.reduce((a, b) => a + b, 0);
    const ket_qua = getResult(total);

    const item = {
      phien,
      ket_qua,
      xuc_xac: dice.join("-"),
      tong: total,
      time: Date.now(),
    };

    const exists = history.find((i) => i.phien == phien);
    if (!exists) {
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
// API CHÍNH
// ===============================
app.get("/", (req, res) => {
  const latest = history[history.length - 1];
  if (!latest) return res.json({ msg: "Đang tải dữ liệu..." });

  const predict = analyze(history);

  // Thống kê tổng
  const results = history.map((h) => h.ket_qua);
  const tai = results.filter((r) => r === "tài").length;
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
      tai,
      xiu,
      ty_le_tai: history.length > 0 ? ((tai / history.length) * 100).toFixed(1) + "%" : "0%",
      ty_le_xiu: history.length > 0 ? ((xiu / history.length) * 100).toFixed(1) + "%" : "0%",
    },
    Lich_su: history.slice(-20),
  });
});

// ===============================
// HISTORY
// ===============================
app.get("/history", (req, res) => {
  res.json(history);
});

// ===============================
// PHÂN TÍCH CHI TIẾT
// ===============================
app.get("/analysis", (req, res) => {
  const results = history.map((h) => h.ket_qua);
  const tai = results.filter((r) => r === "tài").length;
  const xiu = results.length - tai;
  const streak = getCurrentStreak(results);
  const pattern11 = detect11Pattern(results);
  const is22 = detect22Pattern(results);
  const markov = markovProbability(results);
  const streakStat = streakBreakStat(results);

  res.json({
    tong_phien: history.length,
    tai,
    xiu,
    ty_le_tai: history.length > 0 ? ((tai / history.length) * 100).toFixed(2) + "%" : "0%",
    ty_le_xiu: history.length > 0 ? ((xiu / history.length) * 100).toFixed(2) + "%" : "0%",
    streak_hien_tai: streak,
    cau_1_1: pattern11,
    cau_2_2: is22,
    markov_prob_tai: (markov * 100).toFixed(1) + "%",
    streak_break_stat: streakStat,
  });
});

// ===============================
// PREDICT ONLY
// ===============================
app.get("/predict", (req, res) => {
  if (history.length < 3) return res.json({ msg: "Chưa đủ dữ liệu" });
  const predict = analyze(history);
  const latest = history[history.length - 1];
  res.json({
    phien_tiep: Number(latest.phien) + 1,
    du_doan: predict.du_doan,
    do_tin_cay: predict.do_tin_cay,
    cau: predict.cau,
    chi_tiet: predict.chi_tiet,
    vote: predict.vote,
  });
});

// ===============================
// START SERVER
// ===============================
app.listen(PORT, () => {
  console.log(`SERVER RUNNING PORT ${PORT}`);
});