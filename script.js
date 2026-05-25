/******** CONFIG ********/
const DEVICE_ID = "DEVICE_001";
const BASE_URL = "https://iot-miniproject-8582d-default-rtdb.firebaseio.com";

const VITALS_URL = `${BASE_URL}/vitals/${DEVICE_ID}.json`;
const HISTORY_URL = `${BASE_URL}/history/${DEVICE_ID}.json`;
const DASHBOARD_URL = "https://chaithra0926.github.io/remote-health-monitoring/";

emailjs.init("8qKYU9gdC9ftK1Xdo");

/******** UI ELEMENTS ********/
const heartRateEl = document.getElementById("heartRate");
const temperatureEl = document.getElementById("temperature");
const spo2El = document.getElementById("spo2");
const statusEl = document.getElementById("status");
const riskScoreDisplay = document.getElementById("risk-score-display");
const riskBadgeEl = document.getElementById("risk-level-badge");
const riskArrowEl = document.getElementById("risk-arrow");
const riskCaptionEl = document.getElementById("risk-caption");
const ambulanceStatus = document.getElementById("ambulanceStatus");
const locationEl = document.getElementById("location");
const locationLinkEl = document.getElementById("locationLink");
const ML_LABELS = ["NORMAL", "WARNING", "CRITICAL"];

/******** DATA STORE ********/
let labels = [], heartData = [], tempData = [], spo2Data = [];
let historyLabels = [], historyRisk = [];
let doctorEmail = "";
let lastSavedTime = 0;
const SAVE_INTERVAL = 10000;

let mainMonitorInterval = null;

/******** ALERT CONTROL ********/
let lastAlert = "NORMAL";
let alertEmailSent = false;
let dispatchEmailSent = false;
let ambulanceAssigned = false;
let currentDriver = 0;
let lastProcessedResponse = null;
let lastResponseCount = 0;
let consecutiveSeverityCount = 0;
let consecutiveSeverityLevel = "NORMAL";
const ALERT_PERSISTENCE_THRESHOLD = 5;

const patientNameEl = document.getElementById("patientName");
const patientDetailsEl = document.getElementById("patientDetails");

function fetchPatientInfo() {
    fetch(`${BASE_URL}/devicePatientMap/${DEVICE_ID}.json`)
        .then(res => res.json())
        .then(data => {
            if (!data) return;
            patientNameEl.innerText = "👤 " + data.name;
            patientDetailsEl.innerText =
                `🆔 ${data.patientId} | Age: ${data.age} yrs | Gender: ${data.gender} | 📍 ${data.village}`;
        })
        .catch(err => console.error(err));
}
fetchPatientInfo();

/******** DRIVERS ********/
let drivers = [];

function fetchDrivers() {
    fetch(`${BASE_URL}/ambulances.json`)
        .then(res => res.json())
        .then(data => {
            if (!data) return;
            drivers = Object.values(data)
                .filter(d => d.available === true)
                .map(d => d.email);
            console.log("Drivers loaded:", drivers);
        })
        .catch(err => console.error(err));
}
fetchDrivers();

/******** CHART SETUP ********/
const commonOptions = {
    responsive: true,
    maintainAspectRatio: true,
    scales: {
        y: { grid: { display: false }, ticks: { color: "#64748b" } },
        x: { ticks: { display: false }, grid: { display: false } }
    },
    plugins: { legend: { display: false } }
};

const heartChart = new Chart(document.getElementById("heartChart"), {
    type: "line",
    data: { labels, datasets: [{ data: heartData, borderColor: "#fb7185", tension: 0.4, fill: true }] },
    options: commonOptions
});

const tempChart = new Chart(document.getElementById("tempChart"), {
    type: "line",
    data: { labels, datasets: [{ data: tempData, borderColor: "#fbbf24", tension: 0.4 }] },
    options: commonOptions
});

const spo2Chart = new Chart(document.getElementById("spo2Chart"), {
    type: "line",
    data: { labels, datasets: [{ data: spo2Data, borderColor: "#38bdf8", tension: 0.4, fill: true }] },
    options: commonOptions
});

const historyChart = new Chart(document.getElementById("historyChart"), {
    type: "line",
    data: { labels: historyLabels, datasets: [{ data: historyRisk, borderColor: "#818cf8", fill: true }] },
    options: commonOptions
});

/******** GAUGE ********/
const riskGauge = new Chart(document.getElementById("riskGauge"), {
    type: "doughnut",
    data: {
        datasets: [{
            data: [2, 3, 5],
            backgroundColor: ["#4ade80", "#fbbf24", "#fb7185"],
            circumference: 180,
            rotation: 270,
            cutout: "85%"
        }]
    },
    options: { plugins: { legend: { display: false } } }
});

/******** HELPERS ********/
function smooth(prev, curr) {
    return prev ? (prev + curr) / 2 : curr;
}

function getBestLocation(v) {
    const gpsLat = v.lat ?? v.latitude ?? v.gpsLat;
    const gpsLon = v.lng ?? v.lon ?? v.longitude ?? v.gpsLon;
    const espLat = v.esp32Lat ?? v.fallbackLat ?? v.fallbackLatitude;
    const espLon = v.esp32Lon ?? v.fallbackLng ?? v.fallbackLongitude;

    if (gpsLat != null && gpsLon != null) {
        return { lat: parseFloat(gpsLat), lon: parseFloat(gpsLon), source: "gps" };
    }
    if (espLat != null && espLon != null) {
        return { lat: parseFloat(espLat), lon: parseFloat(espLon), source: "esp32" };
    }
    return { lat: null, lon: null, source: null };
}

function getLevelBPM(bpm) {
    if (bpm > 120) return 2;                                        // Critical: >120
    if (bpm < 50) return 2;                                         // Critical: <50
    if ((bpm >= 50 && bpm < 60) || (bpm > 100 && bpm <= 120)) return 1; // Warning: 50-59 or 101-120
    return 0;                                                        // Normal: 60-100
}

function getLevelSpO2(spo2) {
    if (spo2 < 92) return 3;    // Critical: below 92%
    if (spo2 <= 94) return 1;   // Warning: 92–94%
    return 0;                    // Normal: 95–100%
}

function getLevelTemp(temp) {
    if (temp > 38.5) return 3;                    // Critical: above 38.5°C
    if (temp > 37.5 && temp <= 38.5) return 1;    // Warning: 37.6–38.5°C
    if (temp >= 36.5 && temp <= 37.5) return 0;   // Normal: 36.5–37.5°C
    return 1;                                      // Warning: below 36.5°C (hypothermia)
}

/******** RISK CALCULATION ********/
function calculateRisk(v) {
    const bpmL = getLevelBPM(v.bpm);
    const spo2L = getLevelSpO2(v.spo2);
    const tempL = getLevelTemp(v.temperature);

    // VERY CRITICAL CONDITIONS
    if (spo2L === 3 && bpmL === 2) return 10;
    if (spo2L === 3) return 9;
    if (bpmL === 2 && tempL === 3) return 9;

    // HIGH CRITICAL
    if (spo2L === 3 && bpmL >= 1) return 8;   // spo2 critical + any bpm abnormality
    if (tempL === 3) return 7;                 // temp critical alone

    // MODERATE (WARNING)
    if (spo2L === 1 || bpmL === 1 || tempL === 1) return 4;

    // NORMAL
    return 1;
}

function getRiskLevel(score) {
    if (score <= 2) return "NORMAL";
    if (score <= 5) return "WARNING";
    return "CRITICAL";
}

function updateRiskBadge(level) {
    if (!riskBadgeEl || !riskArrowEl || !riskCaptionEl) return;

    const text = level.toUpperCase();
    let arrow = "⬇";
    let color = "#4ade80";
    let caption = "Stable";

    if (text === "WARNING") {
        arrow = "➡";
        color = "#fbbf24";
        caption = "Monitor closely";
    } else if (text === "CRITICAL") {
        arrow = "⬆";
        color = "#fb7185";
        caption = "Immediate action";
    }

    riskBadgeEl.innerText = text;
    riskBadgeEl.className = `risk-badge ${text.toLowerCase()}`;
    riskArrowEl.innerText = arrow;
    riskArrowEl.style.color = color;
    riskCaptionEl.innerText = caption;
}

function computeCRI(v) {
        const spo2 = Number(v.spo2);
        const bpm = Number(v.bpm);
        const temp = Number(v.temperature);

        // SpO2 subscore (0 = best, 100 = worst)
        let spo2Score = 0;
        if (spo2 < 92) spo2Score = 100;
        else if (spo2 <= 94) spo2Score = 65;
        else spo2Score = Math.max(0, 30 - (spo2 - 95) * 5);

        // BPM subscore (distance from 80 as ideal center)
        let bpmScore = 0;
        if (bpm < 50) bpmScore = 100;
        else if (bpm <= 60) bpmScore = 65;
        else if (bpm <= 100) bpmScore = Math.max(0, 20 - Math.abs(80 - bpm) * 0.5);
        else if (bpm <= 120) bpmScore = 65;
        else bpmScore = 100;

        // Temp subscore
        let tempScore = 0;
        if (temp > 38.5) tempScore = 100;
        else if (temp > 37.5) tempScore = 60;
        else if (temp >= 36.5) tempScore = 10;
        else tempScore = 50; // mild hypothermia

        // Weighted aggregate
        let cri = Math.round(spo2Score * 0.45 + bpmScore * 0.35 + tempScore * 0.20);

        // If fever is critical, force the CRI to the maximum critical range.
        if (temp > 38.5) {
            cri = 100;
        }

        // Map numeric CRI to level
        let level = "NORMAL";
        if (cri > 60) level = "CRITICAL";
        else if (cri > 30) level = "WARNING";

        return { cri, level };
}

function combineCRIandML(criValue, mlResult, criLevel) {
        const mlScore = Math.round((mlResult / 2) * 100); // 0 -> 0, 1 -> 50, 2 -> 100

        // weights: CRI 60%, ML 40%
        const combined = Math.round(criValue * 0.6 + mlScore * 0.4);

        let level = "NORMAL";
        if (criLevel === "CRITICAL" || mlResult === 2) {
            level = "CRITICAL";
        } else if (combined > 70) {
            level = "CRITICAL";
        } else if (combined > 40) {
            level = "WARNING";
        }

        return { combined, level };
}

/******** EMAIL ********/
function fetchDoctorEmail() {
    fetch(`${BASE_URL}/doctors/doctor_001.json`)
        .then(res => res.json())
        .then(data => {
            if (!data) return;
            doctorEmail = typeof data === "string" ? data : data.email || data.mail || data.contact;
            console.log("Doctor email:", doctorEmail);
        })
        .catch(err => console.error("Failed to load doctor details:", err));
}
fetchDoctorEmail();

function sendEmail(type, v, riskLevel) {
    if (type === "doctor" && !doctorEmail) {
        console.log("Doctor email not loaded yet");
        return;
    }

    if (v.lat == null || v.lon == null || isNaN(v.lat) || isNaN(v.lon)) {
        console.error("Invalid coordinates, skipping email");
        return;
    }

    const params = {
        to_email: (type === "doctor") ? doctorEmail : drivers[currentDriver],
        email: "system@monitor.com",
        patient: "Cardiac Patient",
        heart: v.bpm,
        temp: v.temperature,
        link: `https://maps.google.com/?q=${v.lat},${v.lon}`,
        dashboard: DASHBOARD_URL
    };

    const template = (type === "doctor") ? "template_gdh8ki6" : "template_1fowsv2";

    emailjs.send("service_2orch13", template, params)
        .then(() => console.log("✅ Email sent to", type))
        .catch(err => {
            console.error("❌ Email Error:", err.message);
            alert(`Email sending failed: ${err.message}`);
        });
}

/******** AMBULANCE ********/
let dispatchTimer = null;
let monitorInterval = null;
let waitingForResponse = false;
const DISPATCH_TIMEOUT = 60000;
const MONITOR_POLL_INTERVAL = 3000;

function sendNextDriver(v, sendEmail = true) {
    if (drivers.length === 0) {
        ambulanceStatus.innerText = "No drivers available";
        return;
    }

    if (currentDriver >= drivers.length) {
        ambulanceStatus.innerText = "No drivers available";
        console.log("All drivers exhausted");
        return;
    }

    fetch(`${BASE_URL}/dispatch/responses.json`)
        .then(res => res.json())
        .then(data => {
            lastResponseCount = data ? Object.values(data).length : 0;
            lastProcessedResponse = null;
            waitingForResponse = true;

            startMonitoringDispatch(v);

            if (sendEmail && drivers[currentDriver]) {
                const acceptLink = `https://chaithra0926.github.io/remote-health-monitoring/respond.html?res=accept&driver=${currentDriver}`;
                const rejectLink = `https://chaithra0926.github.io/remote-health-monitoring/respond.html?res=reject&driver=${currentDriver}`;

                emailjs.send("service_2orch13", "template_1fowsv2", {
                    to_email: drivers[currentDriver],
                    location: `https://maps.google.com/?q=${v.lat},${v.lon}`,
                    bpm: v.bpm,
                    spo2: v.spo2,
                    temp: v.temperature,
                    accept_link: acceptLink,
                    reject_link: rejectLink
                })
                    .then(() => {
                        console.log("📧 Dispatch email sent to Driver " + (currentDriver + 1));
                        dispatchEmailSent = true;
                    })
                    .catch(err => {
                        console.error("❌ Failed to send dispatch email:", err);
                        ambulanceStatus.innerText = "Email dispatch failed";
                    });
            }

            ambulanceStatus.innerText = "Request sent to Driver " + (currentDriver + 1);

            dispatchTimer = setTimeout(() => {
                if (!ambulanceAssigned && waitingForResponse) {
                    console.log("No response, moving to next driver...");
                    currentDriver++;
                    sendNextDriver(v, true);
                }
            }, DISPATCH_TIMEOUT);
        })
        .catch(err => {
            console.error("❌ Failed to initialize dispatch:", err);
            ambulanceStatus.innerText = "Dispatch error";
            waitingForResponse = false;
        });
}

/******** MONITOR RESPONSE ********/
function monitorDispatchOnce(v) {
    if (!waitingForResponse || !v) return;

    fetch(`${BASE_URL}/dispatch/responses.json`)
        .then(res => res.json())
        .then(data => {
            if (!data) return;

            const responses = Object.values(data);
            if (responses.length <= lastResponseCount) return;

            const newResponses = responses.slice(lastResponseCount);
            const last = newResponses[newResponses.length - 1];

            if (last.driver != currentDriver && last.driver != String(currentDriver)) return;

            if (lastProcessedResponse &&
                lastProcessedResponse.response === last.response &&
                lastProcessedResponse.driver === last.driver &&
                lastProcessedResponse.time === last.time) return;

            lastProcessedResponse = last;
            lastResponseCount = responses.length;

            if (last.response === "reject" && !ambulanceAssigned) {
                clearTimeout(dispatchTimer);
                currentDriver++;

                if (currentDriver < drivers.length) {
                    console.log("Driver rejected, trying next driver...");
                    sendNextDriver(v, true);
                } else {
                    console.log("All drivers rejected");
                    waitingForResponse = false;
                    ambulanceStatus.innerText = "All drivers unavailable";
                }
                return;
            }

            if (last.response === "accept") {
                clearTimeout(dispatchTimer);
                ambulanceAssigned = true;
                waitingForResponse = false;
                ambulanceStatus.innerText = "🚑 Ambulance Assigned";
                console.log("✅ Driver accepted dispatch");
                stopMonitoringDispatch();
            }
        })
        .catch(err => {
            console.error("❌ Error monitoring dispatch:", err);
        });
}

function startMonitoringDispatch(v) {
    stopMonitoringDispatch();
    monitorInterval = setInterval(() => monitorDispatchOnce(v), MONITOR_POLL_INTERVAL);
    console.log("📡 Started monitoring dispatch responses");
}

function stopMonitoringDispatch() {
    if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = null;
        console.log("📡 Stopped monitoring dispatch responses");
    }
}

function mlPredict(bpm, spo2, temp) {
    if (spo2 < 92) {
        return 2;
    } else if (spo2 <= 94) {
        return 1;
    } else {
        if (bpm > 120) {
            return 2;
        } else if (bpm <= 61.5) {
            return 1;
        } else {
            return 0;
        }
    }
}

mainMonitorInterval = setInterval(() => {

    fetch(VITALS_URL)
        .then(r => r.json())
        .then(v => {

            if (!v || v.bpm == null || v.temperature == null || v.spo2 == null) return;

            const location = getBestLocation(v);
            v.lat = location.lat;
            v.lon = location.lon;

            const mapLink = (location.lat != null && location.lon != null)
                ? `https://maps.google.com/?q=${location.lat},${location.lon}`
                : null;

            if (mapLink) {
                locationEl.innerText = `${location.lat.toFixed(5)}, ${location.lon.toFixed(5)} (${location.source})`;
                locationLinkEl.href = mapLink;
                locationLinkEl.style.display = "inline-block";
            } else {
                locationEl.innerText = "No valid location available";
                locationLinkEl.style.display = "none";
            }

            v.bpm = smooth(heartData.at(-1), v.bpm);
            v.bpm = Math.round(v.bpm);
            v.temperature = parseFloat(v.temperature);

            // UI
            heartRateEl.innerText = v.bpm;
            temperatureEl.innerText = v.temperature;
            spo2El.innerText = v.spo2;

            // Risk (rule-based) and ML
            const riskScore = calculateRisk(v);
            const riskLevel = getRiskLevel(riskScore);
            const mlResult = mlPredict(v.bpm, v.spo2, v.temperature);
            const mlLevel = ML_LABELS[mlResult];

            // Compute numeric CRI and combine with ML prediction
            const { cri, level: criLevel } = computeCRI(v);
            const combinedResult = combineCRIandML(cri, mlResult, criLevel);
            let finalLevel = combinedResult.level;
            let displayCombined = combinedResult.combined;

            if (v.temperature > 38.5) {
                finalLevel = "CRITICAL";
                displayCombined = 100;
            }

            statusEl.innerText = finalLevel;
            riskScoreDisplay.innerText = `${displayCombined} (CRI:${cri}, ML:${mlLevel})`;
            updateRiskBadge(finalLevel);

            statusEl.style.color =
                finalLevel === "NORMAL" ? "#4ade80" :
                finalLevel === "WARNING" ? "#fbbf24" : "#fb7185";

            // Track consecutive severity for persistence check
            const isAlertLevel = finalLevel === "WARNING" || finalLevel === "CRITICAL";

            if (isAlertLevel && finalLevel === consecutiveSeverityLevel) {
                consecutiveSeverityCount++;
            } else if (isAlertLevel) {
                consecutiveSeverityLevel = finalLevel;
                consecutiveSeverityCount = 1;
            } else {
                consecutiveSeverityLevel = "NORMAL";
                consecutiveSeverityCount = 0;
            }

            // Reset email flags when alert level changes
            if (finalLevel !== lastAlert) {
                alertEmailSent = false;
                dispatchEmailSent = false;
            }

            // ✅ CORRECTION 6: Send doctor email only after persistent alert readings
            // (ALERT_PERSISTENCE_THRESHOLD = 5 consecutive readings)
            if (consecutiveSeverityCount >= ALERT_PERSISTENCE_THRESHOLD && isAlertLevel && !alertEmailSent) {
                sendEmail("doctor", v, finalLevel);
                alertEmailSent = true;
            }

            // Reset when back to normal
            if (finalLevel === "NORMAL") {
                alertEmailSent = false;
                dispatchEmailSent = false;
                consecutiveSeverityCount = 0;
                consecutiveSeverityLevel = "NORMAL";
            }

            // 🚑 Dispatch ambulance only after persistent CRITICAL readings
            if (finalLevel === "CRITICAL" && consecutiveSeverityCount >= ALERT_PERSISTENCE_THRESHOLD && !waitingForResponse && !dispatchEmailSent) {
                if (drivers.length === 0) {
                    console.log("Waiting for drivers...");
                    return;
                }
                lastProcessedResponse = null;
                currentDriver = 0;
                ambulanceAssigned = false;
                dispatchEmailSent = true;
                sendNextDriver(v, true);
            }

            lastAlert = finalLevel;

            // Cleanup when returning to NORMAL
            if (finalLevel === "NORMAL" && waitingForResponse) {
                console.log("Status returned to NORMAL, cleanup dispatch monitoring");
                stopMonitoringDispatch();
                waitingForResponse = false;
                ambulanceAssigned = false;
                currentDriver = 0;
                clearTimeout(dispatchTimer);
            }

            // History save
            if (Date.now() - lastSavedTime > SAVE_INTERVAL) {
                fetch(HISTORY_URL, {
                    method: "POST",
                    body: JSON.stringify({
                        risk: riskScore,
                        time: new Date().toLocaleTimeString()
                    })
                })
                    .catch(err => console.error("Failed to save history:", err));
                lastSavedTime = Date.now();
            }

            // Charts
            const now = new Date().toLocaleTimeString();
            labels.push(now);
            heartData.push(v.bpm);
            tempData.push(v.temperature);
            spo2Data.push(v.spo2);

            if (labels.length > 10) {
                labels.shift();
                heartData.shift();
                tempData.shift();
                spo2Data.shift();
            }

            historyLabels.push(now);
            historyRisk.push(riskScore);

            if (historyLabels.length > 15) {
                historyLabels.shift();
                historyRisk.shift();
            }

            heartChart.update();
            tempChart.update();
            spo2Chart.update();
            historyChart.update();

        })
        .catch((err) => {
            statusEl.innerText = "DISCONNECTED";
            statusEl.style.color = "gray";
            console.error("Data fetch failed:", err);
            stopMonitoringDispatch();
            clearTimeout(dispatchTimer);
            waitingForResponse = false;
        });

}, 2000);

/******** CLEANUP ON PAGE UNLOAD ********/
window.addEventListener('beforeunload', () => {
    console.log("🧹 Cleaning up resources...");
    if (mainMonitorInterval) clearInterval(mainMonitorInterval);
    stopMonitoringDispatch();
    clearTimeout(dispatchTimer);
    console.log("✅ Cleanup complete");
});
