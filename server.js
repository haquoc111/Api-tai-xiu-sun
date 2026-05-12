const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const API_URL =
  "https://bracket-ellen-roads-prefer.trycloudflare.com/api/tx";

// ===============================
// LƯU LỊCH SỬ PHIÊN
// ===============================
let history = [];

// ===============================
// HÀM XÁC ĐỊNH TÀI/XỈU
// ===============================
function getResult(total) {
  return total >= 11 ? "tài" : "xỉu";
}

// ===============================
// THUẬT TOÁN PHÂN TÍCH CẦU
// ===============================
function analyzeBridge(history) {
  if (history.length < 4) {
    return {
      du_doan: "tài",
      do_tin_cay: "50%",
      cau: "Không đủ dữ liệu",
    };
  }

  const last = history[history.length - 1].ket_qua;
  const last2 = history[history.length - 2].ket_qua;
  const last3 = history[history.length - 3].ket_qua;
  const last4 = history[history.length - 4].ket_qua;

  // ===============================
  // CẦU BỆT
  // ===============================
  if (
    last === last2 &&
    last2 === last3 &&
    last3 === last4
  ) {
    return {
      du_doan: last === "tài" ? "xỉu" : "tài",
      do_tin_cay: "78%",
      cau: "Cầu bệt 4",
    };
  }

  // ===============================
  // CẦU 1-1
  // ===============================
  if (
    last !== last2 &&
    last2 !== last3 &&
    last3 !== last4
  ) {
    return {
      du_doan: last === "tài" ? "xỉu" : "tài",
      do_tin_cay: "72%",
      cau: "Cầu 1-1",
    };
  }

  // ===============================
  // ĐẾM TẦN SUẤT
  // ===============================
  const recent = history.slice(-10);

  let tai = 0;
  let xiu = 0;

  recent.forEach((i) => {
    if (i.ket_qua === "tài") tai++;
    else xiu++;
  });

  if (tai > xiu) {
    return {
      du_doan: "xỉu",
      do_tin_cay: "65%",
      cau: "Đảo cầu tài",
    };
  }

  return {
    du_doan: "tài",
    do_tin_cay: "65%",
    cau: "Đảo cầu xỉu",
  };
}

// ===============================
// LẤY DỮ LIỆU API GỐC
// ===============================
async function fetchData() {
  try {
    const response = await axios.get(API_URL, {
      timeout: 10000,
    });

    const data = response.data;

    // ===============================
    // HỖ TRỢ NHIỀU KIỂU API
    // ===============================
    const phien =
      data.phien ||
      data.session ||
      data.id ||
      Date.now();

    const dice =
      data.xuc_xac ||
      data.dice ||
      [1, 1, 1];

    const total = Array.isArray(dice)
      ? dice.reduce((a, b) => a + b, 0)
      : 3;

    const ket_qua = getResult(total);

    // ===============================
    // TẠO DỮ LIỆU PHIÊN
    // ===============================
    const item = {
      phien: phien,
      ket_qua: ket_qua,
      xuc_xac: Array.isArray(dice)
        ? dice.join("-")
        : "1-1-1",
      tong: total,
      time: Date.now(),
    };

    // ===============================
    // TRÁNH THÊM TRÙNG PHIÊN
    // ===============================
    const exists = history.find(
      (i) => i.phien == phien
    );

    if (!exists) {
      history.push(item);

      // Giữ tối đa 100 phiên
      if (history.length > 100) {
        history.shift();
      }

      console.log("Đã thêm phiên:", phien);
    }
  } catch (err) {
    console.log("Lỗi API:", err.message);
  }
}

// ===============================
// UPDATE TỰ ĐỘNG
// ===============================
setInterval(fetchData, 5000);

// Chạy lần đầu
fetchData();

// ===============================
// API CHÍNH
// ===============================
app.get("/", async (req, res) => {
  const latest = history[history.length - 1];

  if (!latest) {
    return res.json({
      message: "Đang lấy dữ liệu...",
    });
  }

  const predict = analyzeBridge(history);

  res.json({
    Id: "Ha Quoc",

    Phien: latest.phien,

    Ket_qua: latest.ket_qua,

    Xuc_xac: latest.xuc_xac,

    Tong: latest.tong,

    Phien_nay: Number(latest.phien) + 1,

    Du_doan: predict.du_doan,

    Do_tin_cay: predict.do_tin_cay,

    Cau: predict.cau,

    Lich_su: history.slice(-15),
  });
});

// ===============================
// API LỊCH SỬ
// ===============================
app.get("/history", (req, res) => {
  res.json(history);
});

// ===============================
// API PHÂN TÍCH
// ===============================
app.get("/analysis", (req, res) => {
  let tai = 0;
  let xiu = 0;

  history.forEach((i) => {
    if (i.ket_qua === "tài") tai++;
    else xiu++;
  });

  res.json({
    tong_phien: history.length,
    tai: tai,
    xiu: xiu,
    ty_le_tai:
      history.length > 0
        ? ((tai / history.length) * 100).toFixed(2) + "%"
        : "0%",
    ty_le_xiu:
      history.length > 0
        ? ((xiu / history.length) * 100).toFixed(2) + "%"
        : "0%",
  });
});

// ===============================
// KHỞI ĐỘNG SERVER
// ===============================
app.listen(PORT, () => {
  console.log(
    `Server đang chạy tại http://localhost:${PORT}`
  );
});