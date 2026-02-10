/************ CONFIG ************/
const DEVICE_ID = "DEVICE_001";
const BASE_URL = "https://iot-miniproject-8582d-default-rtdb.firebaseio.com";

/************ EMAILJS ************/
emailjs.init("8qKYU9gdC9ftK1Xdo"); // ← replace

const SERVICE_ID = "service_2orch13";   // ← replace
const TEMPLATE_ID = "template_gdh8ki6"; // ← replace

/************ URLS ************/
const VITALS_URL = `${BASE_URL}/vitals/${DEVICE_ID}.json`;
const DEVICE_URL = `${BASE_URL}/devices/${DEVICE_ID}.json`;
const PATIENT_URL = `${BASE_URL}/devicePatientMap/${DEVICE_ID}.json`;

/************ UI ************/
const heartRateEl = document.getElementById("heartRate");
const temperatureEl = document.getElementById("temperature");
const statusEl = document.getElementById("status");
const patientTitle = document.getElementById("patientTitle");

/************ DATA ************/
let labels = [];
let heartData = [];
let tempData = [];

let doctorEmail = "";
let patientName = "";
let alertSent = false;

/************ LOAD DOCTOR EMAIL ************/
fetch(DEVICE_URL)
  .then(r => r.json())
  .then(d => fetch(`${BASE_URL}/doctors/${d.assignedDoctor}.json`))
  .then(r => r.json())
  .then(doc => doctorEmail = doc.email);

/************ LOAD PATIENT NAME ************/
fetch(PATIENT_URL)
  .then(r => r.json())
  .then(p => {
    if (p && p.name) {
      patientName = p.name;
      patientTitle.innerHTML = `Patient: ${p.name}`;
    }
  });

/************ CHART SETUP (FIXED) ************/
const heartCtx = document.getElementById("heartChart").getContext("2d");
const tempCtx  = document.getElementById("tempChart").getContext("2d");

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } }
};

const heartChart = new Chart(heartCtx, {
  type: "line",
  data: {
    labels: labels,
    datasets: [{
      data: heartData,
      borderColor: "#fb7185",
      fill: true
    }]
  },
  options: chartOptions
});

const tempChart = new Chart(tempCtx, {
  type: "line",
  data: {
    labels: labels,
    datasets: [{
      data: tempData,
      borderColor: "#38bdf8",
      fill: true
    }]
  },
  options: chartOptions
});

/************ EMERGENCY CHECK ************/
function isEmergency(v) {
  return v.heartRate > 120 || v.temperature > 39;
}

/************ SEND EMAIL (ANTI-SPAM) ************/
function sendEmail(v) {
  emailjs.send(SERVICE_ID, TEMPLATE_ID, {
    to_email: doctorEmail,
    patient: patientName,
    heart: v.heartRate,
    temp: v.temperature,
    link: "https://chaithra0926.github.io/remote-health-monitoring/"
  });
}

/************ MAIN LOOP ************/
setInterval(() => {
  fetch(VITALS_URL)
    .then(r => r.json())
    .then(v => {
      if (!v) return;

      // UI update
      heartRateEl.innerHTML = `${v.heartRate} <span>BPM</span>`;
      temperatureEl.innerHTML = `${v.temperature} <span>°C</span>`;

      // Emergency logic
      if (isEmergency(v)) {
        statusEl.textContent = "EMERGENCY";
        statusEl.style.color = "#fb7185";

        if (!alertSent) {
          sendEmail(v);
          alertSent = true;
        }

      } else {
        statusEl.textContent = "NORMAL";
        statusEl.style.color = "#4ade80";
        alertSent = false;
      }

      // Graph update
      const time = new Date().toLocaleTimeString();
      labels.push(time);
      heartData.push(v.heartRate);
      tempData.push(v.temperature);

      if (labels.length > 10) {
        labels.shift();
        heartData.shift();
        tempData.shift();
      }

      heartChart.update();
      tempChart.update();
    });
}, 1000);

