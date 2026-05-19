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
const ML_LABELS = ["NORMAL","WARNING","CRITICAL"];

/******** DATA STORE ********/
let labels = [], heartData = [], tempData = [], spo2Data = [];
let historyLabels = [], historyRisk = [];
let doctorEmail = "";
let lastSavedTime = 0;
const SAVE_INTERVAL = 10000;

let mainMonitorInterval = null;  // ✅ Track main vitals monitoring

/******** ALERT CONTROL ********/
let lastAlert = "NORMAL";
let alertEmailSent = false;  // 🔴 Track if alert email was already sent
let dispatchEmailSent = false;  // 🚑 Track if dispatch email was already sent for current incident
let ambulanceAssigned = false;
let currentDriver = 0;
let lastProcessedResponse = null;
let lastResponseCount = 0;
let consecutiveSeverityCount = 0; // 🔁 Count repeated WARNING/CRITICAL readings
let consecutiveSeverityLevel = "NORMAL";
const ALERT_PERSISTENCE_THRESHOLD = 5;
/****new****/
const patientNameEl = document.getElementById("patientName");
const patientDetailsEl = document.getElementById("patientDetails");

function fetchPatientInfo(){
    fetch(`${BASE_URL}/devicePatientMap/${DEVICE_ID}.json`)
    .then(res => res.json())
    .then(data => {
        if(!data) return;

        patientNameEl.innerText = "👤 " + data.name;

        patientDetailsEl.innerText =
            `🆔 ${data.patientId} | Age: ${data.age} yrs | Gender: ${data.gender} | 📍 ${data.village}`;
    })
    .catch(err => console.error(err));
}

fetchPatientInfo();

/******** DRIVERS (UPDATED - FROM FIREBASE) ********/
let drivers = [];

function fetchDrivers(){
    fetch(`${BASE_URL}/ambulances.json`)
    .then(res => res.json())
    .then(data => {
        if(!data) return;

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
            data: [2,3,5],
            backgroundColor: ["#4ade80","#fbbf24","#fb7185"],
            circumference: 180,
            rotation: 270,
            cutout: "85%"
        }]
    },
    options: { plugins: { legend: { display: false } } }
});


/******** HELPERS ********/
function smooth(prev, curr){
    return prev ? (prev + curr)/2 : curr;
}

function getBestLocation(v){
    const gpsLat = v.lat ?? v.latitude ?? v.gpsLat;
    const gpsLon = v.lng ?? v.lon ?? v.longitude ?? v.gpsLon;
    const espLat = v.esp32Lat ?? v.fallbackLat ?? v.fallbackLatitude;
    const espLon = v.esp32Lon ?? v.fallbackLng ?? v.fallbackLongitude;

    if(gpsLat != null && gpsLon != null){
        return { lat: parseFloat(gpsLat), lon: parseFloat(gpsLon), source: "gps" };
    }
    if(espLat != null && espLon != null){
        return { lat: parseFloat(espLat), lon: parseFloat(espLon), source: "esp32" };
    }
    return { lat: null, lon: null, source: null };
}

/******** RISK CALCULATION ********/
function getLevelBPM(bpm){
if(bpm > 140) return 3;
if(bpm > 120 || bpm < 50) return 2;
if((bpm >= 50 && bpm < 60) || (bpm > 100 && bpm <= 120)) return 1;
return 0;
}
function getLevelSpO2(spo2){
if(spo2 < 88) return 3;
if(spo2 < 92) return 2;
if(spo2 <= 94) return 1;
return 0;
}
function getLevelTemp(temp){
if(temp >= 40) return 3;
if(temp > 38.5) return 2;
if(temp > 37.5) return 1;
return 0;
}
function calculateRisk(v){
const bpmL = getLevelBPM(v.bpm);
const spo2L = getLevelSpO2(v.spo2);
const tempL = getLevelTemp(v.temperature);
// VERY CRITICAL CONDITIONS
if(spo2L === 3 && bpmL === 3) return 10;
if(spo2L === 3) return 9;
if(bpmL === 3 && tempL >= 2) return 9;
// HIGH CRITICAL
if(spo2L === 2 && bpmL >= 2) return 8;
if(spo2L === 2) return 7;
// MODERATE (WARNING)
if(spo2L === 1 || bpmL === 1) return 4;
// NORMAL
return 1;
}
function getRiskLevel(score){
if(score <= 2) return "NORMAL";
if(score <= 5) return "WARNING";
return "CRITICAL";
}

function updateRiskBadge(level){
    if(!riskBadgeEl || !riskArrowEl || !riskCaptionEl) return;

    const text = level.toUpperCase();
    let arrow = "⬇";
    let color = "#4ade80";
    let caption = "Stable";

    if(text === "WARNING"){
        arrow = "➡";
        color = "#fbbf24";
        caption = "Monitor closely";
    } else if(text === "CRITICAL"){
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

/******** EMAIL ********/
function fetchDoctorEmail(){
    fetch(`${BASE_URL}/doctors/doctor_001.json`)
    .then(res => res.json())
    .then(data => {
        if(!data) return;
        doctorEmail = typeof data === "string" ? data : data.email || data.mail || data.contact;
        console.log("Doctor email:", doctorEmail);
    })
    .catch(err => console.error("Failed to load doctor details:", err));
}
fetchDoctorEmail();
function sendEmail(type, v, riskLevel){

    // ❗ check if email is loaded
    if(type === "doctor" && !doctorEmail){
        console.log("Doctor email not loaded yet");
        return;
    }

    // ❗ VALIDATE COORDINATES
    if(v.lat == null || v.lon == null || isNaN(v.lat) || isNaN(v.lon)){
        console.error("Invalid coordinates, skipping email");
        return;
    }

    const params = {
        to_email: (type === "doctor")
            ? doctorEmail   // 🔥 from Firebase
            : drivers[currentDriver],

        email: "system@monitor.com",

        patient: "Cardiac Patient",
        heart: v.bpm,
        temp: v.temperature,
        link: `https://maps.google.com/?q=${v.lat},${v.lon}`,
        dashboard: DASHBOARD_URL
    };

    const template =
        (type === "doctor")
        ? "template_gdh8ki6"
        : "template_1fowsv2";

    emailjs.send("service_2orch13", template, params)
        .then(()=>console.log("✅ Email sent to", type))
        .catch(err=>{
            console.error("❌ Email Error:", err.message);
            alert(`Email sending failed: ${err.message}`);
        });
}

/******** AMBULANCE ********/
let dispatchTimer = null;
let monitorInterval = null;  // ✅ Track polling interval
let waitingForResponse = false;
const DISPATCH_TIMEOUT = 60000;  // 1 minute per driver
const MONITOR_POLL_INTERVAL = 3000;  // Poll every 3 seconds (was 2s)

function sendNextDriver(v, sendEmail = true){  // 🔴 Only send email on first call

    if(drivers.length === 0){
        ambulanceStatus.innerText = "No drivers available";
        return;
    }

    if(currentDriver >= drivers.length){
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
            
            // ✅ Start monitoring only after request sent
            startMonitoringDispatch(v);

            // 🔴 ONLY send email if this is the first dispatch attempt
            if(sendEmail && drivers[currentDriver]){
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
                .then(()=>{
                    console.log("📧 Dispatch email sent to Driver " + (currentDriver+1));
                    dispatchEmailSent = true;
                })
                .catch(err=>{
                    console.error("❌ Failed to send dispatch email:", err);
                    ambulanceStatus.innerText = "Email dispatch failed";
                });
            }

            ambulanceStatus.innerText = "Request sent to Driver " + (currentDriver+1);

            // ⏱ WAIT TIMEOUT BEFORE TRYING NEXT DRIVER
            dispatchTimer = setTimeout(() => {
                if(!ambulanceAssigned && waitingForResponse){
                    console.log("No response, moving to next driver...");
                    currentDriver++;
                    sendNextDriver(v, true);  // Send email to next driver
                }
            }, DISPATCH_TIMEOUT);
        })
        .catch(err => {
            console.error("❌ Failed to initialize dispatch:", err);
            ambulanceStatus.innerText = "Dispatch error";
            waitingForResponse = false;
        });
}

/******** MONITOR RESPONSE - OPTIMIZED ********/
function monitorDispatchOnce(v){
    if(!waitingForResponse || !v) return;

    fetch(`${BASE_URL}/dispatch/responses.json`)
    .then(res => res.json())
    .then(data => {

        if(!data) return;

        const responses = Object.values(data);
        if(responses.length <= lastResponseCount) return;

        const newResponses = responses.slice(lastResponseCount);
        const last = newResponses[newResponses.length - 1];

        // ✅ Validate driver match
        if(last.driver != currentDriver && last.driver != String(currentDriver)) return;
        
        // ✅ Prevent duplicate processing
        if(lastProcessedResponse && lastProcessedResponse.response === last.response && lastProcessedResponse.driver === last.driver && lastProcessedResponse.time === last.time) return;

        lastProcessedResponse = last;
        lastResponseCount = responses.length;

        if(last.response === "reject" && !ambulanceAssigned){
            clearTimeout(dispatchTimer);
            currentDriver++;
            
            // ✅ Check if there are more drivers available
            if(currentDriver < drivers.length){
                console.log("Driver rejected, trying next driver...");
                sendNextDriver(v, true);
            } else {
                console.log("All drivers rejected");
                waitingForResponse = false;
                ambulanceStatus.innerText = "All drivers unavailable";
            }
            return;
        }

        if(last.response === "accept"){
            clearTimeout(dispatchTimer);
            ambulanceAssigned = true;
            waitingForResponse = false;
            ambulanceStatus.innerText = "🚑 Ambulance Assigned";
            console.log("✅ Driver accepted dispatch");
            
            // ✅ Stop polling once accepted
            stopMonitoringDispatch();
        }
    })
    .catch(err => {
        console.error("❌ Error monitoring dispatch:", err);
    });
}

// ✅ START/STOP MONITORING to avoid continuous polling
function startMonitoringDispatch(v){
    stopMonitoringDispatch();  // Clear any existing interval
    monitorInterval = setInterval(() => monitorDispatchOnce(v), MONITOR_POLL_INTERVAL);
    console.log("📡 Started monitoring dispatch responses");
}

function stopMonitoringDispatch(){
    if(monitorInterval){
        clearInterval(monitorInterval);
        monitorInterval = null;
        console.log("📡 Stopped monitoring dispatch responses");
    }
}
//prediction
function mlPredict(bpm, spo2, temp){
if(spo2 <= 91.5){
return 2; // CRITICAL
}
else if(spo2 <= 94.5){
return 1; // WARNING
}
else {
if(bpm <= 61.5){
return 1; // WARNING
} else {
return 0; // NORMAL
}
}
}

/******** MAIN LOOP ********/
mainMonitorInterval = setInterval(()=>{

    fetch(VITALS_URL)
    .then(r=>r.json())
    .then(v=>{

        if(!v || v.bpm==null || v.temperature==null || v.spo2==null) return;

        // location fallback: prefer GPS lat/lng, otherwise use ESP32 fallback coords
        const location = getBestLocation(v);
        v.lat = location.lat;
        v.lon = location.lon;

        const mapLink = (location.lat != null && location.lon != null)
            ? `https://maps.google.com/?q=${location.lat},${location.lon}`
            : null;

        if(mapLink){
            locationEl.innerText = `${location.lat.toFixed(5)}, ${location.lon.toFixed(5)} (${location.source})`;
            locationLinkEl.href = mapLink;
            locationLinkEl.style.display = "inline-block";
        } else {
            locationEl.innerText = "No valid location available";
            locationLinkEl.style.display = "none";
        }

        // smooth and normalize BPM to match displayed value
        v.bpm = smooth(heartData.at(-1), v.bpm);
        v.bpm = Math.round(v.bpm);
        v.temperature = parseFloat(v.temperature);

        // UI
        heartRateEl.innerText = v.bpm;
        temperatureEl.innerText = v.temperature;
        spo2El.innerText = v.spo2;

        // Risk
        const riskScore = calculateRisk(v);
        const riskLevel = getRiskLevel(riskScore);
        const mlResult = mlPredict(v.bpm, v.spo2, v.temperature);
        const mlLevel = ML_LABELS[mlResult];

        const finalLevel =
        (mlLevel === "CRITICAL" || riskLevel === "CRITICAL") ? "CRITICAL" :
        (mlLevel === "WARNING" || riskLevel === "WARNING") ? "WARNING" :
        "NORMAL";

        statusEl.innerText = finalLevel;
        riskScoreDisplay.innerText = riskScore;
        updateRiskBadge(finalLevel);

        // color
        statusEl.style.color =
            finalLevel==="NORMAL"?"#4ade80":
            finalLevel==="WARNING"?"#fbbf24":"#fb7185";

        // track alert persistence
        const isAlertLevel = finalLevel === "WARNING" || finalLevel === "CRITICAL";

        if (isAlertLevel && finalLevel === consecutiveSeverityLevel){
            consecutiveSeverityCount++;
        } else if (isAlertLevel) {
            consecutiveSeverityLevel = finalLevel;
            consecutiveSeverityCount = 1;
        } else {
            consecutiveSeverityLevel = "NORMAL";
            consecutiveSeverityCount = 0;
        }

        // email trigger only after persistent alert readings
        if (finalLevel !== lastAlert){
            alertEmailSent = false;
            dispatchEmailSent = false;
        }

        if (consecutiveSeverityCount >= ALERT_PERSISTENCE_THRESHOLD && isAlertLevel && !alertEmailSent){
            sendEmail("doctor", v, finalLevel);
            alertEmailSent = true;
        }

        if (finalLevel === "NORMAL"){
            alertEmailSent = false;
            dispatchEmailSent = false;
            consecutiveSeverityCount = 0;
            consecutiveSeverityLevel = "NORMAL";
        }

        // 🚑 Send dispatch ONLY after 3 consecutive CRITICAL readings
        if (finalLevel === "CRITICAL" && consecutiveSeverityCount >= ALERT_PERSISTENCE_THRESHOLD && !waitingForResponse && !dispatchEmailSent){
            if(drivers.length === 0){
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

        // ✅ CLEANUP: Stop monitoring and reset when returning to NORMAL
        if(finalLevel === "NORMAL" && waitingForResponse){
            console.log("Status returned to NORMAL, cleanup dispatch monitoring");
            stopMonitoringDispatch();
            waitingForResponse = false;
            ambulanceAssigned = false;
            currentDriver = 0;
            clearTimeout(dispatchTimer);
        }

        // history save
        if(Date.now()-lastSavedTime > SAVE_INTERVAL){
            fetch(HISTORY_URL,{
                method:"POST",
                body:JSON.stringify({
                    risk:riskScore,
                    time:new Date().toLocaleTimeString()
                })
            })
            .catch(err => console.error("Failed to save history:", err));
            lastSavedTime = Date.now();
        }

        // charts
        const now = new Date().toLocaleTimeString();

        labels.push(now);
        heartData.push(v.bpm);
        tempData.push(v.temperature);
        spo2Data.push(v.spo2);

        if(labels.length>10){
            labels.shift();
            heartData.shift();
            tempData.shift();
            spo2Data.shift();
        }

        historyLabels.push(now);
        historyRisk.push(riskScore);

        if(historyLabels.length>15){
            historyLabels.shift();
            historyRisk.shift();
        }

        heartChart.update();
        tempChart.update();
        spo2Chart.update();
        historyChart.update();

    })
    .catch((err)=>{
        statusEl.innerText="DISCONNECTED";
        statusEl.style.color="gray";
        console.error("Data fetch failed:", err);
        
        // ✅ CLEANUP on disconnect
        stopMonitoringDispatch();
        clearTimeout(dispatchTimer);
        waitingForResponse = false;
    });

},2000);

/******** CLEANUP ON PAGE UNLOAD ********/
window.addEventListener('beforeunload', () => {
    console.log("🧹 Cleaning up resources...");
    
    if(mainMonitorInterval) clearInterval(mainMonitorInterval);
    stopMonitoringDispatch();
    clearTimeout(dispatchTimer);
    
    console.log("✅ Cleanup complete");
});
