const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const app = express();
const PORT = process.env.PORT || 3000;

// Khởi tạo cache cho lịch sử dữ liệu với thời gian sống 1 giờ (3600 giây)
const historicalDataCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

// URL API gốc của Sunwin để lấy dữ liệu Tài Xỉu
const SUNWIN_API_URL = 'https://sicbosun-6esb.onrender.com/api/sicbosun';

/**
 * Lớp quản lý dữ liệu lịch sử và các phép tính cơ bản.
 */
class HistoricalDataManager {
    constructor(maxHistoryLength = 500) {
        this.history = [];
        this.maxHistoryLength = maxHistoryLength;
    }

    addSession(newData) {
        if (!newData || !newData.phien) return false;
        if (this.history.some(item => item.phien === newData.phien)) return false;

        this.history.push(newData);
        if (this.history.length > this.maxHistoryLength) {
            this.history = this.history.slice(this.history.length - this.maxHistoryLength);
        }
        this.history.sort((a, b) => a.phien - b.phien);
        return true;
    }

    getHistory() {
        return [...this.history];
    }

    getRecentHistory(count) {
        return this.history.slice(-count);
    }

    calculateFrequency(dataSubset) {
        let taiCount = 0, xiuCount = 0;
        if (!dataSubset || dataSubset.length === 0) {
            return { taiCount: 0, xiuCount: 0, totalCount: 0, taiRatio: 0, xiuRatio: 0 };
        }
        dataSubset.forEach(item => {
            if (item.ket_qua === 'Tài') taiCount++;
            else if (item.ket_qua === 'Xỉu') xiuCount++;
        });
        const totalCount = dataSubset.length;
        const taiRatio = totalCount > 0 ? taiCount / totalCount : 0;
        const xiuRatio = totalCount > 0 ? xiuCount / totalCount : 0;
        return { taiCount, xiuCount, totalCount, taiRatio, xiuRatio };
    }

    calculateCurrentSequence(dataSubset, resultType) {
        if (!dataSubset || dataSubset.length === 0) return 0;
        let count = 0;
        for (let i = dataSubset.length - 1; i >= 0; i--) {
            if (dataSubset[i].ket_qua === resultType) count++;
            else break;
        }
        return count;
    }
}

/**
 * Lớp thuật toán phân tích đa chiều để đưa ra dự đoán.
 */
class PredictionEngine {
    constructor(historyMgr) {
        this.historyMgr = historyMgr;
        this.baseWeights = {
            bet: 5.0,
            dao11: 4.5,
            dao22: 4.0,
            tyLeApDao: 3.0,
            daoDongThap: 2.5,
            mauLapLai: 2.0,
            default: 1.0
        };
    }

    predict() {
        const fullHistory = this.historyMgr.getHistory();
        const historyLength = fullHistory.length;

        if (historyLength === 0) {
            return this.buildResult("Chưa xác định", 10);
        }

        const recentHistory = this.historyMgr.getRecentHistory(100);
        const lastResult = recentHistory[recentHistory.length - 1].ket_qua;

        if (historyLength === 1) {
            const du_doan = (lastResult === 'Tài') ? "Xỉu" : "Tài";
            return this.buildResult(du_doan, 30);
        }

        let predictionScores = { 'Tài': 0, 'Xỉu': 0 };
        let dynamicWeights = { ...this.baseWeights };

        const recent30 = this.historyMgr.getRecentHistory(30);
        const recent10 = this.historyMgr.getRecentHistory(10);

        // Thuật toán 1: Cầu Bệt
        const taiSequence = this.historyMgr.calculateCurrentSequence(recent10, 'Tài');
        const xiuSequence = this.historyMgr.calculateCurrentSequence(recent10, 'Xỉu');
        if (taiSequence >= 4) {
            predictionScores['Xỉu'] += taiSequence * dynamicWeights.bet;
        } else if (xiuSequence >= 4) {
            predictionScores['Tài'] += xiuSequence * dynamicWeights.bet;
        }

        // Thuật toán 2: Cầu Đảo
        if (this.isAlternating(recent10, 1) && recent10.length >= 6) {
            const nextPrediction = (lastResult === 'Tài') ? "Xỉu" : "Tài";
            predictionScores[nextPrediction] += dynamicWeights.dao11;
        }
        if (this.isAlternating(recent10, 2) && recent10.length >= 8) {
            const nextPrediction = (lastResult === 'Tài') ? "Xỉu" : "Tài";
            predictionScores[nextPrediction] += dynamicWeights.dao22;
        }

        // Thuật toán 3: Cầu Gãy
        if (taiSequence === 2 && recent10[recent10.length - 3]?.ket_qua === 'Xỉu') {
            predictionScores['Xỉu'] += dynamicWeights.daoDongThap;
        }
        if (xiuSequence === 2 && recent10[recent10.length - 3]?.ket_qua === 'Tài') {
            predictionScores['Tài'] += dynamicWeights.daoDongThap;
        }

        // Thuật toán 4: Tỷ lệ áp đảo
        if (recent30.length >= 10) {
            const { taiRatio, xiuRatio } = this.historyMgr.calculateFrequency(recent30);
            if (Math.abs(taiRatio - xiuRatio) > 0.3) {
                const nextPrediction = (taiRatio > xiuRatio) ? "Xỉu" : "Tài";
                predictionScores[nextPrediction] += (Math.abs(taiRatio - xiuRatio) * 10) * dynamicWeights.tyLeApDao;
            }
        }

        // Thuật toán 5: Mẫu hình lặp lại
        if (recent10.length >= 4) {
            const patternToMatch = recent10.slice(-2).map(p => p.ket_qua).join('-');
            const pastChunk = recent10.slice(0, -2);
            let countMatch = 0;
            for (let i = 0; i < pastChunk.length - 1; i++) {
                if (`${pastChunk[i].ket_qua}-${pastChunk[i + 1].ket_qua}` === patternToMatch) {
                    countMatch++;
                }
            }
            if (countMatch > 1) {
                const nextPrediction = (lastResult === 'Tài') ? "Xỉu" : "Tài";
                predictionScores[nextPrediction] += countMatch * dynamicWeights.mauLapLai;
            }
        }

        // Thuật toán 6: Dự đoán cơ bản
        const defaultPrediction = (lastResult === 'Tài') ? "Xỉu" : "Tài";
        predictionScores[defaultPrediction] += dynamicWeights.default;

        // Tổng hợp kết quả
        let finalPrediction = "Chưa xác định";
        let finalScore = 0;
        if (predictionScores['Tài'] > predictionScores['Xỉu']) {
            finalPrediction = 'Tài';
            finalScore = predictionScores['Tài'];
        } else if (predictionScores['Xỉu'] > predictionScores['Tài']) {
            finalPrediction = 'Xỉu';
            finalScore = predictionScores['Xỉu'];
        } else {
            finalPrediction = defaultPrediction;
            finalScore = predictionScores[defaultPrediction];
        }

        const totalScore = predictionScores['Tài'] + predictionScores['Xỉu'];
        let confidence = (finalScore / totalScore) * 100;
        confidence = confidence * Math.min(1, historyLength / 100);
        confidence = Math.min(99.99, Math.max(10, confidence));

        return this.buildResult(finalPrediction, confidence);
    }

    isAlternating(history, groupSize) {
        if (history.length < groupSize * 2) return false;
        const recent = history.slice(-groupSize * 2);
        for (let i = 0; i < recent.length; i += groupSize * 2) {
            const group1 = recent.slice(i, i + groupSize);
            const group2 = recent.slice(i + groupSize, i + groupSize * 2);
            if (group1.length !== group2.length || group1[0].ket_qua === group2[0].ket_qua) {
                return false;
            }
        }
        return true;
    }

    buildResult(du_doan, do_tin_cay) {
        return {
            du_doan: du_doan,
            do_tin_cay: do_tin_cay.toFixed(2)
        };
    }
}

// Khởi tạo trình quản lý lịch sử và công cụ dự đoán
const historyManager = new HistoricalDataManager(500);
const predictionEngine = new PredictionEngine(historyManager);

// --- API Endpoints ---
app.get('/concac/ditme/sicbosun', async (req, res) => {
    let currentData = null;
    let cachedHistoricalData = historicalDataCache.get("full_history");

    if (cachedHistoricalData) {
        historyManager.history = cachedHistoricalData;
    }

    try {
        const response = await axios.get(SUNWIN_API_URL, { timeout: 5000 });
        currentData = response.data;

        if (currentData && currentData.phien && currentData.ket_qua) {
            historyManager.addSession(currentData);
            historicalDataCache.set("full_history", historyManager.getHistory());
        }

        const { du_doan, do_tin_cay } = predictionEngine.predict();

        const result = {
            id: "@cskhtoollxk",
            phien: currentData ? currentData.phien : null,
            ket_qua: currentData ? currentData.ket_qua : null,
            xuc_xac: currentData ? [currentData.xuc_xac_1, currentData.xuc_xac_2, currentData.xuc_xac_3] : [],
            tong: currentData ? currentData.tong : null,
            phien_sau: currentData
                ? currentData.phien + 1
                : (historyManager.getHistory().length > 0
                    ? historyManager.getHistory().slice(-1)[0].phien + 1
                    : null),
            du_doan: du_doan,
            do_tin_cay: do_tin_cay
        };

        res.json(result);

    } catch (error) {
        console.error("Lỗi khi gọi API hoặc xử lý dữ liệu:", error.message);
        if (historyManager.getHistory().length > 0) {
            const { du_doan, do_tin_cay } = predictionEngine.predict();
            res.status(200).json({
                id: "@CsTool001 - VanwNhat",
                error_from_api: "Không thể lấy dữ liệu phiên hiện tại. Sử dụng dữ liệu lịch sử cached.",
                phien_sau: historyManager.getHistory().slice(-1)[0].phien + 1,
                du_doan: du_doan,
                do_tin_cay: (parseFloat(do_tin_cay) * 0.8).toFixed(2)
            });
        } else {
            res.status(500).json({
                id: "@CsTool001 - VanwNhat",
                error: "Không thể lấy dữ liệu từ API gốc và không có lịch sử để phân tích.",
                du_doan: "Không thể dự đoán",
                do_tin_cay: 0
            });
        }
    }
});

app.get('/', (req, res) => {
    res.send('CÓ CÁI CON CẶC MUA API - TOOL IB @cskhtoollxk');
});

app.listen(PORT, () => {
    console.log(`Server đang chạy trên cổng ${PORT}`);
});