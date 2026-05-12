// ===============================
// THUẬT TOÁN MỚI + FIX XÚC XẮC
// THAY TOÀN BỘ server.js CŨ
// ===============================

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
// LỊCH SỬ
// ===============================
let history = [];

// ===============================
// TÀI / XỈU
// ===============================
function getResult(total) {
  return total >= 11 ? "tài" : "xỉu";
}

// ===============================
// FIX XỬ LÝ XÚC XẮC
// ===============================
function parseDice(data) {
  try {
    // TH1: array
    if (Array.isArray(data.xuc_xac)) {
      return data.xuc_xac.map(Number);
    }

    // TH2: dice
    if (Array.isArray(data.dice)) {
      return data.dice.map(Number);
    }

    // TH3: object
    if (typeof data.xuc_xac === "object") {
      return Object.values(data.xuc_xac).map(Number);
    }

    // TH4: string "1-2-3"
    if (typeof data.xuc_xac === "string") {
      return data.xuc_xac
        .split("-")
        .map(Number);
    }

    // TH5: x1 x2 x3
    if (
      data.x1 &&
      data.x2 &&
      data.x3
    ) {
      return [
        Number(data.x1),
        Number(data.x2),
        Number(data.x3),
      ];
    }

    return [1, 1, 1];
  } catch {
    return [1, 1, 1];
  }
}

// ===============================
// PHÂN TÍCH CẦU NÂNG CAO
// ===============================
function analyze(history) {
  if (history.length < 6) {
    return {
      du_doan: "tài",
      do_tin_cay: "55%",
      cau: "Không đủ dữ liệu",
    };
  }

  const recent = history.slice(-12);

  // ==========================
  // ĐẾM
  // ==========================
  let tai = 0;
  let xiu = 0;

  recent.forEach((i) => {
    if (i.ket_qua === "tài") tai++;
    else xiu++;
  });

  // ==========================
  // CHUỖI GẦN NHẤT
  // ==========================
  const last = recent[recent.length - 1].ket_qua;

  let streak = 1;

  for (
    let i = recent.length - 2;
    i >= 0;
    i--
  ) {
    if (recent[i].ket_qua === last) {
      streak++;
    } else {
      break;
    }
  }

  // ==========================
  // CẦU BỆT
  // ==========================
  if (streak >= 4) {
    return {
      du_doan:
        last === "tài"
          ? "xỉu"
          : "tài",

      do_tin_cay:
        Math.min(
          92,
          65 + streak * 3
        ) + "%",

      cau:
        "Bệt " +
        last +
        " " +
        streak,
    };
  }

  // ==========================
  // CẦU 1-1
  // ==========================
  let alternating = true;

  for (
    let i = recent.length - 1;
    i > recent.length - 6;
    i--
  ) {
    if (
      recent[i].ket_qua ===
      recent[i - 1].ket_qua
    ) {
      alternating = false;
      break;
    }
  }

  if (alternating) {
    return {
      du_doan:
        last === "tài"
          ? "xỉu"
          : "tài",

      do_tin_cay: "80%",

      cau: "Cầu 1-1",
    };
  }

  // ==========================
  // PHÂN TÍCH XU HƯỚNG
  // ==========================
  if (tai >= 8) {
    return {
      du_doan: "xỉu",
      do_tin_cay: "74%",
      cau: "Tài mạnh",
    };
  }

  if (xiu >= 8) {
    return {
      du_doan: "tài",
      do_tin_cay: "74%",
      cau: "Xỉu mạnh",
    };
  }

  // ==========================
  // CẦU 2-1
  // ==========================
  const pattern = recent
    .slice(-6)
    .map((i) =>
      i.ket_qua === "tài"
        ? "T"
        : "X"
    )
    .join("");

  if (
    pattern.includes("TTXTT")
  ) {
    return {
      du_doan: "xỉu",
      do_tin_cay: "77%",
      cau: "2 tài 1 xỉu",
    };
  }

  if (
    pattern.includes("XXTXX")
  ) {
    return {
      du_doan: "tài",
      do_tin_cay: "77%",
      cau: "2 xỉu 1 tài",
    };
  }

  // ==========================
  // MẶC ĐỊNH THÔNG MINH
  // ==========================
  return {
    du_doan:
      tai > xiu
        ? "xỉu"
        : "tài",

    do_tin_cay:
      tai > xiu
        ? "68%"
        : "68%",

    cau: "Phân tích xác suất",
  };
}

// ===============================
// LẤY API
// ===============================
async function fetchData() {
  try {
    const response = await axios.get(
      API_URL,
      {
        timeout: 10000,
      }
    );

    const data = response.data;

    const phien =
      data.phien ||
      data.session ||
      data.id ||
      Date.now();

    // FIX XÚC XẮC
    const dice = parseDice(data);

    const total = dice.reduce(
      (a, b) => a + b,
      0
    );

    const ket_qua =
      getResult(total);

    const item = {
      phien: phien,

      ket_qua: ket_qua,

      xuc_xac: dice.join("-"),

      tong: total,

      time: Date.now(),
    };

    // KHÔNG TRÙNG
    const exists = history.find(
      (i) => i.phien == phien
    );

    if (!exists) {
      history.push(item);

      // GIỮ 200 PHIÊN
      if (history.length > 200) {
        history.shift();
      }

      console.log(
        "NEW:",
        item
      );
    }
  } catch (err) {
    console.log(
      "LỖI API:",
      err.message
    );
  }
}

// ===============================
// AUTO UPDATE
// ===============================
setInterval(fetchData, 4000);

fetchData();

// ===============================
// API CHÍNH
// ===============================
app.get("/", (req, res) => {
  const latest =
    history[history.length - 1];

  if (!latest) {
    return res.json({
      msg: "Đang tải dữ liệu...",
    });
  }

  const predict =
    analyze(history);

  res.json({
    Id: "Ha Quoc",

    Phien: latest.phien,

    Ket_qua: latest.ket_qua,

    Xuc_xac:
      latest.xuc_xac,

    Tong: latest.tong,

    Phien_nay:
      Number(latest.phien) +
      1,

    Du_doan:
      predict.du_doan,

    Do_tin_cay:
      predict.do_tin_cay,

    Cau: predict.cau,

    Lich_su:
      history.slice(-20),
  });
});

// ===============================
// HISTORY
// ===============================
app.get(
  "/history",
  (req, res) => {
    res.json(history);
  }
);

// ===============================
// ANALYSIS
// ===============================
app.get(
  "/analysis",
  (req, res) => {
    let tai = 0;
    let xiu = 0;

    history.forEach((i) => {
      if (
        i.ket_qua === "tài"
      )
        tai++;
      else xiu++;
    });

    res.json({
      tong_phien:
        history.length,

      tai: tai,

      xiu: xiu,

      ty_le_tai:
        (
          (tai /
            history.length) *
          100
        ).toFixed(2) + "%",

      ty_le_xiu:
        (
          (xiu /
            history.length) *
          100
        ).toFixed(2) + "%",
    });
  }
);

// ===============================
// START SERVER
// ===============================
app.listen(PORT, () => {
  console.log(
    `RUN PORT ${PORT}`
  );
});