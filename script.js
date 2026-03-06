/************ CONFIG ************/
const DEVICE_ID = "DEVICE_001";
const BASE_URL = "https://iot-miniproject-8582d-default-rtdb.firebaseio.com";

/************ EMAILJS ************/
emailjs.init("8qKYU9gdC9ftK1Xdo");

const SERVICE_ID = "service_2orch13";
const TEMPLATE_ID = "template_gdh8ki6";

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

/* 🔒 Alert control */
let alertSent = false;
let emergencyStartTime = null;
const EMERGENCY_CONFIRM_TIME = 5000;

/************ GET PATIENT LOCATION ************/
function updatePatientLocation(){

  if(!navigator.geolocation){
    console.log("Geolocation not supported");
    return;
  }

  navigator.geolocation.getCurrentPosition(function(position){

    const lat = position.coords.latitude;
    const lng = position.coords.longitude;

    fetch(VITALS_URL,{
      method:"PATCH",
      headers:{ "Content-Type":"application/json"},
      body:JSON.stringify({
        lat: lat,
        lng: lng
      })
    });

    console.log("Patient location updated:",lat,lng);

  });

}

/* Update location every 30 seconds */
setInterval(updatePatientLocation,30000);

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

/************ CHART SETUP ************/
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
  return v.temperature > 37 || v.temperature < 33;
}

/************ SEND EMAIL ************/
function sendEmail(v) {

  const mapLink =
    `https://maps.google.com/?q=${v.lat || ""},${v.lng || ""}`;

  emailjs.send(SERVICE_ID, TEMPLATE_ID, {
    to_email: doctorEmail,
    patient: patientName,
    heart: v.heartRate,
    temp: v.temperature,
    link: mapLink
  });

}

/************ MAIN LOOP ************/
setInterval(() => {
  fetch(VITALS_URL)
    .then(r => r.json())
    .then(v => {
      if (!v) return;

      /* UI update */
      heartRateEl.innerHTML = `${v.heartRate} <span>BPM</span>`;
      temperatureEl.innerHTML = `${v.temperature} <span>°C</span>`;

      /* 🔥 STABLE EMERGENCY LOGIC */
      if (isEmergency(v)) {

        statusEl.textContent = "EMERGENCY";
        statusEl.style.color = "#fb7185";

        if (!emergencyStartTime) {
          emergencyStartTime = Date.now();
        }

        if (
          Date.now() - emergencyStartTime >= EMERGENCY_CONFIRM_TIME &&
          !alertSent
        ) {
          sendEmail(v);
          alertSent = true;
          console.log("📧 Emergency confirmed, email sent");
        }

      } else {

        statusEl.textContent = "NORMAL";
        statusEl.style.color = "#4ade80";

        emergencyStartTime = null;
        alertSent = false;

      }

      /* Graph update */
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
