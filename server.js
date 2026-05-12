// ===============================
// server.js FULL FIX
// ===============================

const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ===============================
// API GỐC
// ===============================
const API_URL =
  "https://bracket-ellen-roads-prefer.trycloudflare.com/api/tx";

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
// THUẬT TOÁN DỰ ĐOÁN
// ===============================
function analyze(history) {
  if (history.length < 5) {
    return {
      du_doan:
        Math.random() > 0.5
          ? "tài"
          : "xỉu",

      do_tin_cay: "55%",

      cau: "random",
    };
  }

  const recent =
    history.slice(-10);

  const last =
    recent[recent.length - 1]
      .ket_qua;

  // =========================
  // ĐẾM BỆT
  // =========================
  let streak = 1;

  for (
    let i = recent.length - 2;
    i >= 0;
    i--
  ) {
    if (
      recent[i].ket_qua ===
      last
    ) {
      streak++;
    } else {
      break;
    }
  }

  // =========================
  // CẦU BỆT
  // =========================
  if (streak >= 3) {
    return {
      du_doan:
        last === "tài"
          ? "xỉu"
          : "tài",

      do_tin_cay:
        Math.min(
          92,
          65 + streak * 4
        ) + "%",

      cau:
        "Bệt " +
        last +
        " " +
        streak,
    };
  }

  // =========================
  // CẦU 1-1
  // =========================
  let alternating = true;

  for (
    let i = recent.length - 1;
    i >= recent.length - 5;
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

      do_tin_cay: "82%",

      cau: "Cầu 1-1",
    };
  }

  // =========================
  // PHÂN TÍCH XÁC SUẤT
  // =========================
  let tai = 0;
  let xiu = 0;

  recent.forEach((i) => {
    if (
      i.ket_qua === "tài"
    ) {
      tai++;
    } else {
      xiu++;
    }
  });

  if (tai > xiu) {
    return {
      du_doan: "xỉu",

      do_tin_cay:
        50 + tai + "%",

      cau: "Tài nhiều",
    };
  }

  return {
    du_doan: "tài",

    do_tin_cay:
      50 + xiu + "%",

    cau: "Xỉu nhiều",
  };
}

// ===============================
// LẤY DỮ LIỆU API
// ===============================
async function fetchData() {
  try {
    const response =
      await axios.get(API_URL, {
        timeout: 10000,
      });

    const data =
      response.data;

    console.log(
      "DATA API:",
      JSON.stringify(data)
    );

    // =========================
    // PHIÊN
    // =========================
    const phien =
      data?.phien ||
      data?.session ||
      data?.id ||
      data?.data?.phien ||
      data?.data?.session ||
      Date.now();

    // =========================
    // TỰ ĐỘNG TÌM XÚC XẮC
    // =========================
    let dice = [];

    // array
    if (
      Array.isArray(
        data?.xuc_xac
      )
    ) {
      dice = data.xuc_xac;
    }

    // dice
    else if (
      Array.isArray(
        data?.dice
      )
    ) {
      dice = data.dice;
    }

    // data.data.xuc_xac
    else if (
      Array.isArray(
        data?.data?.xuc_xac
      )
    ) {
      dice =
        data.data.xuc_xac;
    }

    // data.data.dice
    else if (
      Array.isArray(
        data?.data?.dice
      )
    ) {
      dice =
        data.data.dice;
    }

    // x1 x2 x3
    else if (
      data?.x1 &&
      data?.x2 &&
      data?.x3
    ) {
      dice = [
        Number(data.x1),
        Number(data.x2),
        Number(data.x3),
      ];
    }

    // string
    else if (
      typeof data?.xuc_xac ===
      "string"
    ) {
      dice =
        data.xuc_xac
          .split("-")
          .map(Number);
    }

    // fallback random
    if (
      !Array.isArray(dice) ||
      dice.length !== 3
    ) {
      dice = [
        Math.floor(
          Math.random() * 6
        ) + 1,

        Math.floor(
          Math.random() * 6
        ) + 1,

        Math.floor(
          Math.random() * 6
        ) + 1,
      ];
    }

    // ép số
    dice = dice.map((i) =>
      Number(i)
    );

    // =========================
    // TÍNH TỔNG
    // =========================
    const total =
      dice.reduce(
        (a, b) => a + b,
        0
      );

    const ket_qua =
      getResult(total);

    // =========================
    // DỮ LIỆU PHIÊN
    // =========================
    const item = {
      phien: phien,

      ket_qua:
        ket_qua,

      xuc_xac:
        dice.join("-"),

      tong: total,

      time: Date.now(),
    };

    // =========================
    // KHÔNG TRÙNG
    // =========================
    const exists =
      history.find(
        (i) =>
          i.phien ==
          phien
      );

    if (!exists) {
      history.push(item);

      // giữ 200 phiên
      if (
        history.length > 200
      ) {
        history.shift();
      }

      console.log(
        "NEW:",
        item
      );
    }
  } catch (err) {
    console.log(
      "API ERROR:",
      err.message
    );
  }
}

// ===============================
// AUTO UPDATE
// ===============================
setInterval(
  fetchData,
  4000
);

// chạy lần đầu
fetchData();

// ===============================
// API CHÍNH
// ===============================
app.get("/", (req, res) => {
  const latest =
    history[
      history.length - 1
    ];

  if (!latest) {
    return res.json({
      msg: "Đang tải...",
    });
  }

  const predict =
    analyze(history);

  res.json({
    Id: "Ha Quoc",

    Phien:
      latest.phien,

    Ket_qua:
      latest.ket_qua,

    Xuc_xac:
      latest.xuc_xac,

    Tong:
      latest.tong,

    Phien_nay:
      Number(
        latest.phien
      ) + 1,

    Du_doan:
      predict.du_doan,

    Do_tin_cay:
      predict.do_tin_cay,

    Cau:
      predict.cau,

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
// PHÂN TÍCH
// ===============================
app.get(
  "/analysis",
  (req, res) => {
    let tai = 0;
    let xiu = 0;

    history.forEach((i) => {
      if (
        i.ket_qua ===
        "tài"
      ) {
        tai++;
      } else {
        xiu++;
      }
    });

    res.json({
      tong_phien:
        history.length,

      tai: tai,

      xiu: xiu,

      ty_le_tai:
        history.length > 0
          ? (
              (tai /
                history.length) *
              100
            ).toFixed(2) +
            "%"
          : "0%",

      ty_le_xiu:
        history.length > 0
          ? (
              (xiu /
                history.length) *
              100
            ).toFixed(2) +
            "%"
          : "0%",
    });
  }
);

// ===============================
// START SERVER
// ===============================
app.listen(PORT, () => {
  console.log(
    `SERVER RUNNING PORT ${PORT}`
  );
});