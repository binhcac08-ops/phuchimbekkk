const express = require('express');
const axios = require('axios');
const { validationResult } = require('express-validator');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Cấu hình Axios với xử lý lỗi và thử lại nâng cao ---
const axiosInstance = axios.create({
  timeout: 5000,
});

axiosInstance.interceptors.response.use(
  response => response,
  async error => {
    const { config, response } = error;
    if (!response || response.status >= 500 || error.code === 'ECONNABORTED' || error.code === 'ENOTFOUND') {
      const MAX_RETRIES = 3;
      config.__retryCount = config.__retryCount || 0;

      if (config.__retryCount < MAX_RETRIES) {
        config.__retryCount += 1;
        const delay = Math.pow(2, config.__retryCount) * 100;
        console.warn(`Lỗi kết nối hoặc máy chủ (${error.message}). Đang thử lại lần ${config.__retryCount} sau ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return axiosInstance(config);
      }
    }
    return Promise.reject(error);
  }
);

// --- Hàm tính ma trận chuyển đổi Markov ---
// Sử dụng tất cả dữ liệu có sẵn
function buildTransitionMatrix(history) {
  let transitions = { 'T': { 'T': 0, 'X': 0 }, 'X': { 'T': 0, 'X': 0 } };
  let tCount = 0;
  let xCount = 0;

  if (history.length < 2) {
    return { 'T': { 'T': 0, 'X': 0 }, 'X': { 'T': 0, 'X': 0 } };
  }

  let prev = history[0].tong >= 11 ? 'T' : 'X';

  for (let i = 1; i < history.length; i++) {
    const current = history[i].tong >= 11 ? 'T' : 'X';
    transitions[prev][current]++;
    if (prev === 'T') tCount++; else xCount++;
    prev = current;
  }

  const matrix = {
    'T': {
      'T': tCount > 0 ? transitions['T']['T'] / tCount : 0,
      'X': tCount > 0 ? transitions['T']['X'] / tCount : 0
    },
    'X': {
      'T': xCount > 0 ? transitions['X']['T'] / xCount : 0,
      'X': xCount > 0 ? transitions['X']['X'] / xCount : 0
    }
  };

  return matrix;
}

// --- Hàm tính xác suất thực tế của tổng 3 xúc xắc ---
function getTrueSumProbabilities() {
  const sumCounts = {};
  for (let d1 = 1; d1 <= 6; d1++) {
    for (let d2 = 1; d2 <= 6; d2++) {
      for (let d3 = 1; d3 <= 6; d3++) {
        const sum = d1 + d2 + d3;
        sumCounts[sum] = (sumCounts[sum] || 0) + 1;
      }
    }
  }

  const totalOutcomes = 216;
  const probabilities = {};
  for (const sum in sumCounts) {
    probabilities[sum] = (sumCounts[sum] / totalOutcomes) * 100;
  }
  return probabilities;
}

// --- Hàm dự đoán Tài/Xỉu bằng "AI VIP" (kết hợp Markov và tần suất) ---
// Sử dụng tất cả dữ liệu có sẵn
function predictTaiXiu(history) {
  if (history.length === 0) {
    return {
      prediction: 'Không đủ dữ liệu',
      confidence: 'Không xác định'
    };
  }

  const lastState = history[0].tong >= 11 ? 'T' : 'X';
  const markovMatrix = buildTransitionMatrix(history);

  let prediction;
  let confidence;

  if (lastState === 'T') {
    const probT = markovMatrix['T']['T'];
    const probX = markovMatrix['T']['X'];
    if (probT > probX) {
      prediction = 'Tài';
      confidence = (probT / (probT + probX)) * 100;
    } else {
      prediction = 'Xỉu';
      confidence = (probX / (probT + probX)) * 100;
    }
  } else {
    const probT = markovMatrix['X']['T'];
    const probX = markovMatrix['X']['X'];
    if (probT > probX) {
      prediction = 'Tài';
      confidence = (probT / (probT + probX)) * 100;
    } else {
      prediction = 'Xỉu';
      confidence = (probX / (probT + probX)) * 100;
    }
  }

  // Phân tích chuỗi gần nhất
  const recentPattern = history.slice(0, 5).map(h => h.tong >= 11 ? 'T' : 'X');
  const lastFiveSame = recentPattern.length >= 5 && recentPattern.every(p => p === recentPattern[0]);

  if (lastFiveSame && recentPattern[0] === 'T' && prediction === 'Tài') {
    return {
      prediction: 'Xỉu',
      confidence: 'Thấp (phân tích chuỗi cho thấy khả năng đảo chiều)'
    };
  }
  if (lastFiveSame && recentPattern[0] === 'X' && prediction === 'Xỉu') {
    return {
      prediction: 'Tài',
      confidence: 'Thấp (phân tích chuỗi cho thấy khả năng đảo chiều)'
    };
  }

  return {
    prediction,
    confidence: `${(confidence || 0).toFixed(2)}% (dựa trên phân tích Markov)`
  };
}

// --- Hàm dự đoán 5 vị (tổng) bằng thuật toán kết hợp AI ---
// Sử dụng tất cả dữ liệu có sẵn
function predict5Sums(history) {
  if (history.length === 0) {
    return [];
  }

  const trueSumProbabilities = getTrueSumProbabilities();

  const recentSums = history.map(h => h.tong);
  const sumFrequencies = {};
  recentSums.forEach(sum => {
    sumFrequencies[sum] = (sumFrequencies[sum] || 0) + 1;
  });

  const combinedScores = {};
  for (const sum in trueSumProbabilities) {
    const trueProb = trueSumProbabilities[sum];
    const recentFreq = sumFrequencies[sum] || 0;
    const score = trueProb * (1 + (recentFreq / history.length));
    combinedScores[sum] = score;
  }

  const predictedSums = Object.entries(combinedScores)
    .sort(([, scoreA], [, scoreB]) => scoreB - scoreA)
    .slice(0, 5)
    .map(([sum, score]) => ({
      sum: parseInt(sum),
      probability: `${(trueSumProbabilities[sum]).toFixed(2)}%`,
      frequency_score: `${(score).toFixed(2)}`
    }));

  return predictedSums;
}

// --- Middleware xử lý lỗi tập trung cho Express ---
app.use((err, req, res, next) => {
  console.error('Lỗi máy chủ:', err.stack);
  if (res.headersSent) {
    return next(err);
  }
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Đã xảy ra lỗi không xác định trên máy chủ.',
    }
  });
});

// --- API endpoint chính ---
app.get('/api/sicbo/lxk', async (req, res, next) => {
  try {
    const response = await axiosInstance.get('https://sicbosun-100.onrender.com/api');
    const history = response.data;

    // Chỉ kiểm tra dữ liệu rỗng, không yêu cầu số lượng cụ thể
    if (!Array.isArray(history) || history.length === 0) {
      return res.status(200).json({
        phien_truoc: null,
        xuc_xac: null,
        tong: null,
        ket_qua: null,
        phien_sau: null,
        du_doan: "Không đủ dữ liệu lịch sử để dự đoán.",
        doan_vi: [],
        luu_y: "Cần ít nhất một phiên để bắt đầu phân tích."
      });
    }

    const latest = history[0];
    const phien_sau = String(parseInt(latest.phien) + 1);

    const duDoanTaiXiu = predictTaiXiu(history);
    const duDoan5Vi = predict5Sums(history);

    const result = {
      phien_truoc: latest.phien,
      xuc_xac: `${latest.xuc_xac_1} - ${latest.xuc_xac_2} - ${latest.xuc_xac_3}`,
      tong: latest.tong,
      ket_qua: latest.ket_qua,
      phien_sau: phien_sau,
      du_doan: duDoanTaiXiu.prediction,
      doan_vi: duDoan5Vi,
      luu_y: "Các dự đoán trên chỉ dựa trên phân tích xác suất và tần suất lịch sử, không có thuật toán nào đảm bảo kết quả chính xác trong trò chơi ngẫu nhiên như Tài Xỉu."
    };

    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.listen(PORT, () => {
  console.log(`✅ API Phân tích & Dự đoán Sicbo đang chạy tại http://localhost:${PORT}`);
  console.log(`⚠️ Lưu ý: Đây là công cụ phân tích thống kê, không phải công cụ dự đoán chắc chắn. Tài Xỉu là trò chơi may rủi.`);
});
