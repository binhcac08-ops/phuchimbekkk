const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const app = express();
const PORT = process.env.PORT || 3000;

// Cache lịch sử (1h)
const historicalDataCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

// URL API gốc
const SUNWIN_API_URL = 'https://sicbosun-6esb.onrender.com/api/sicbosun';

// Quản lý lịch sử
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
        return {
            taiCount,
            xiuCount,
            totalCount,
            taiRatio: totalCount > 0 ? taiCount / totalCount : 0,
            xiuRatio: totalCount > 0 ? xiuCount / totalCount : 0
        };
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

// Engine dự đoán
class PredictionEngine {
    constructor(historyMgr) {
        this.historyMgr = historyMgr;
        this.baseWeights = {
            bet: 5.0,
            dao11: 4.5,
            dao22: 4.0,
            dao33: 3.8,
            tyLeApDao: 3.0,
            mauLapLai: 3.5,
            uuTienGanDay: 3.2,
            default: 1.0
        };
    }

    // Dự đoán vị (công thức có thể đổi sau)
    duDoanVi(tong) {
        if (!tong) return [];
        return [
            ((tong % 6) + 10),
            ((tong % 6) + 11),
            ((tong % 6) + 12)
        ];
    }

    predict() {
        const fullHistory = this.historyMgr.getHistory();
        const historyLength = fullHistory.length;

        if (historyLength === 0) {
            return this.buildResult("Chưa xác định", 10, "Không có dữ liệu");
        }

        const recentHistory = this.historyMgr.getRecentHistory(100);
        const lastResult = recentHistory[recentHistory.length - 1].ket_qua;

        if (historyLength === 1) {
            const du_doan = (lastResult === 'Tài') ? "Xỉu" : "Tài";
            return this.buildResult(du_doan, 30, "Chỉ có 1 phiên → dự đoán đảo cầu.");
        }

        let predictionScores = { 'Tài': 0, 'Xỉu': 0 };
        let dynamicWeights = { ...this.baseWeights };

        const recent30 = this.historyMgr.getRecentHistory(30);
        const recent10 = this.historyMgr.getRecentHistory(10);
        const recent20 = this.historyMgr.getRecentHistory(20);

        // Cầu bệt
        const taiSeq = this.historyMgr.calculateCurrentSequence(recent10, 'Tài');
        const xiuSeq = this.historyMgr.calculateCurrentSequence(recent10, 'Xỉu');
        if (taiSeq >= 4) {
            predictionScores['Xỉu'] += taiSeq * dynamicWeights.bet;
        } else if (xiuSeq >= 4) {
            predictionScores['Tài'] += xiuSeq * dynamicWeights.bet;
        }

        // Cầu đảo 1-1
        if (this.isAlternating(recent10, 1) && recent10.length >= 6) {
            const nextPred = (lastResult === 'Tài') ? "Xỉu" : "Tài";
            predictionScores[nextPred] += dynamicWeights.dao11;
        }

        // Cầu đảo 2-2
        if (this.isAlternating(recent10, 2) && recent10.length >= 8) {
            const nextPred = (lastResult === 'Tài') ? "Xỉu" : "Tài";
            predictionScores[nextPred] += dynamicWeights.dao22;
        }

        // Cầu 3-3
        if (this.isAlternating(recent20, 3) && recent20.length >= 12) {
            const nextPred = (lastResult === 'Tài') ? "Xỉu" : "Tài";
            predictionScores[nextPred] += dynamicWeights.dao33;
        }

        // Mẫu lặp lại 5 phiên
        if (recent20.length >= 10) {
            const last5 = recent20.slice(-5).map(r => r.ket_qua).join("");
            const prev5 = recent20.slice(-10, -5).map(r => r.ket_qua).join("");
            if (last5 === prev5) {
                const nextPred = last5[0] === 'Tài' ? "Tài" : "Xỉu";
                predictionScores[nextPred] += dynamicWeights.mauLapLai;
            }
        }

        // Cầu nhồi (7 phiên gần nhất)
        if (recent10.length >= 7) {
            const taiCount = recent10.filter(r => r.ket_qua === 'Tài').length;
            const xiuCount = recent10.filter(r => r.ket_qua === 'Xỉu').length;
            if (taiCount >= 5) {
                predictionScores['Tài'] += dynamicWeights.uuTienGanDay;
            } else if (xiuCount >= 5) {
                predictionScores['Xỉu'] += dynamicWeights.uuTienGanDay;
            }
        }

        // Tỷ lệ 30 phiên
        if (recent30.length >= 10) {
            const { taiRatio, xiuRatio } = this.historyMgr.calculateFrequency(recent30);
            if (Math.abs(taiRatio - xiuRatio) > 0.3) {
                const nextPred = (taiRatio > xiuRatio) ? "Xỉu" : "Tài";
                predictionScores[nextPred] += (Math.abs(taiRatio - xiuRatio) * 10) * dynamicWeights.tyLeApDao;
            }
        }

        // Default: đảo cầu
        const defaultPrediction = (lastResult === 'Tài') ? "Xỉu" : "Tài";
        predictionScores[defaultPrediction] += dynamicWeights.default;

        // Tổng hợp
        let finalPrediction = predictionScores['Tài'] > predictionScores['Xỉu'] ? 'Tài' : 'Xỉu';
        let finalScore = predictionScores[finalPrediction];
        const totalScore = predictionScores['Tài'] + predictionScores['Xỉu'];
        let confidence = (finalScore / totalScore) * 100;

        confidence = confidence * Math.min(1, historyLength / 100);
        confidence = Math.min(99.99, Math.max(10, confidence));

        // ⚡ Giải thích cố định
        return this.buildResult(
            finalPrediction,
            confidence,
            "địt con mẹ mày"
        );
    }

    isAlternating(history, groupSize) {
        if (history.length < groupSize * 2) return false;
        const recent = history.slice(-groupSize * 2);
        return recent.slice(0, groupSize).every(r => r.ket_qua !== recent[groupSize].ket_qua);
    }

    buildResult(du_doan, do_tin_cay, giai_thich) {
        return { du_doan, do_tin_cay: do_tin_cay.toFixed(2), giai_thich };
    }
}

const historyManager = new HistoricalDataManager(500);
const predictionEngine = new PredictionEngine(historyManager);

// Hàm hỗ trợ gọi API với cơ chế thử lại khi gặp lỗi 429
async function fetchDataWithRetry(url, retries = 3, delay = 1000) {
    try {
        const response = await axios.get(url, { timeout: 5000 });
        return response.data;
    } catch (error) {
        if (error.response && error.response.status === 429 && retries > 0) {
            console.warn(`Đã nhận lỗi 429, đang thử lại sau ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return fetchDataWithRetry(url, retries - 1, delay * 2);
        }
        throw error;
    }
}

// API chính
app.get('/concac/ditme/lxk', async (req, res) => {
    let currentData = null;
    let cachedHistoricalData = historicalDataCache.get("full_history");
    if (cachedHistoricalData) {
        historyManager.history = cachedHistoricalData;
    }

    try {
        const data = await fetchDataWithRetry(SUNWIN_API_URL);
        currentData = data;

        if (currentData && currentData.phien && currentData.ket_qua) {
            historyManager.addSession(currentData);
            historicalDataCache.set("full_history", historyManager.getHistory());
        }

        const { du_doan, do_tin_cay, giai_thich } = predictionEngine.predict();

        const phien_truoc = currentData ? currentData.phien : historyManager.getHistory().slice(-1)[0]?.phien;
        const tong_truoc = currentData ? currentData.tong : historyManager.getHistory().slice(-1)[0]?.tong;
        const viDuDoan = predictionEngine.duDoanVi(tong_truoc);

        const result = {
            id: "@cskhtoollxk",
            phien_truoc: phien_truoc,
            ket_qua: currentData ? currentData.ket_qua : null,
            xuc_xac: currentData ? [currentData.xuc_xac_1, currentData.xuc_xac_2, currentData.xuc_xac_3] : [],
            tong: tong_truoc,
            phien_sau: phien_truoc ? phien_truoc + 1 : null,
            du_doan: du_doan,
            do_tin_cay: do_tin_cay,
            du_doan_vi: viDuDoan,
            giai_thich: giai_thich
        };

        res.json(result);
    } catch (error) {
        console.error("Lỗi API:", error.message);
        res.status(500).json({ error: "API lỗi", chi_tiet: error.message });
    }
});

app.get('/', (req, res) => {
    res.send('CÓ CÁI ĐẦU BUỒI');
});

app.listen(PORT, () => {
    console.log(`Server đang chạy trên cổng ${PORT}`);
});
        
