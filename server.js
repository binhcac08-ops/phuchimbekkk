const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// URL API lịch sử của bạn
const HISTORY_API_URL = 'https://hitclub-n2b4.onrender.com/api/hit';

// Cache để lưu trữ giá trị độ tin cậy và số phiên
let cachedConfidence = null;
let cachedSession = null;

// --- THUẬT TOÁN DỰ ĐOÁN ---

// Hàm dự đoán theo xí ngầu
function duDoanTheoXiNgau(diceList) {
    if (!diceList || diceList.length === 0) {
        return "Đợi thêm dữ liệu";
    }
    const [d1, d2, d3] = diceList.slice(-1)[0];
    const total = d1 + d2 + d3;
    const resultList = [];

    for (const d of [d1, d2, d3]) {
        let tmp = d + total;
        if (tmp in [4, 5]) {
            tmp -= 4;
        } else if (tmp >= 6) {
            tmp -= 6;
        }
        resultList.push(tmp % 2 === 0 ? "Tài" : "Xỉu");
    }

    const counts = {};
    resultList.forEach(item => {
        counts[item] = (counts[item] || 0) + 1;
    });

    return Object.keys(counts).reduce((a, b) => (counts[a] > counts[b]) ? a : b, "");
}

// Hàm tạo số ngẫu nhiên cho độ tin cậy
function getRandomConfidence() {
    const min = 40.00;
    const max = 90.00;
    const confidence = Math.random() * (max - min) + min;
    return confidence.toFixed(2);
}

// Hàm dự đoán chính
function predictTaiXiu(historicalData) {
    if (!historicalData || historicalData.length < 1) {
        return {
            du_doan: "Đang thu thập dữ liệu...",
            do_tin_cay: "Chưa đủ",
            giai_thich: "Chưa có dữ liệu để phân tích.",
        };
    }
    
    const diceArray = historicalData.map(item => item.dice);
    const predictionByDice = duDoanTheoXiNgau(diceArray);

    return {
        du_doan: predictionByDice,
        do_tin_cay: getRandomConfidence() + "%",
        giai_thich: "Dự đoán dựa trên thuật toán phân tích xí ngầu.",
    };
}

// Endpoint chính để lấy dự đoán
app.get('/api/taixiu/du_doan_hit', async (req, res) => {
    try {
        const response = await axios.get(HISTORY_API_URL);

        // Bọc dữ liệu nếu chỉ trả về 1 object
        const historicalDataNewFormat = Array.isArray(response.data) ? response.data : [response.data];

        if (!historicalDataNewFormat || historicalDataNewFormat.length === 0) {
            return res.status(404).json({
                error: "Không thể lấy dữ liệu lịch sử.",
                du_doan: "Không thể dự đoán",
                do_tin_cay: "0%",
                giai_thich: "Lỗi hệ thống hoặc không đủ dữ liệu."
            });
        }

        // Mapping dữ liệu theo API mới
        const historicalData = historicalDataNewFormat.map(item => ({
            session: item.sid,
            dice: [item.Xuc_xac_1, item.Xuc_xac_2, item.Xuc_xac_3],
            total: item.Tong,
            result: item.Ket_qua,
        }));

        const currentData = historicalData[0];
        const previousSession = currentData.session - 1;
        const nextSession = currentData.session + 1;
        const { du_doan } = predictTaiXiu(historicalData);

        // Cache độ tin cậy theo phiên trước
        if (cachedSession !== previousSession) {
            cachedSession = previousSession;
            cachedConfidence = getRandomConfidence() + "%";
        }

        const result = {
            id: "@cskhtoollxk",
            sid: previousSession,  // phiên trước
            xuc_xac: currentData.dice,
            tong_xuc_xac: currentData.total,
            ket_qua: currentData.result,
            phien_sau: nextSession,
            du_doan: du_doan,
            do_tin_cay: cachedConfidence,
            giai_thich: "yêu anh đi chim a to lắm óoo.",
        };
        res.json(result);

    } catch (error) {
        console.error("Lỗi khi xử lý dữ liệu:", error.message);
        res.status(500).json({
            error: "Lỗi hệ thống hoặc không thể xử lý dự đoán.",
            details: error.message,
            du_doan: "Không thể dự đoán",
            do_tin_cay: "0%",
            giai_thich: "Lỗi hệ thống hoặc không đủ dữ liệu."
        });
    }
});

app.get('/', (req, res) => {
    res.send('Chào mừng đến với API dự đoán Tài Xỉu! Truy cập /api/taixiu/du_doan_68gb để xem dự đoán.');
});

app.listen(PORT, () => {
    console.log(`Server đang chạy trên cổng ${PORT}`);
});
