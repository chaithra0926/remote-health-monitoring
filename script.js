/******** CONFIG ********/

const DEVICE_ID="DEVICE_001"

const BASE_URL="https://iot-miniproject-8582d-default-rtdb.firebaseio.com"

/******** EMAILJS ********/

emailjs.init("8qKYU9gdC9ftK1Xdo")

const SERVICE_ID="service_2orch13"
const TEMPLATE_ID="template_gdh8ki6"

/******** URLS ********/

const VITALS_URL=`${BASE_URL}/vitals/${DEVICE_ID}.json`
const DEVICE_URL=`${BASE_URL}/devices/${DEVICE_ID}.json`
const PATIENT_URL=`${BASE_URL}/devicePatientMap/${DEVICE_ID}.json`

/******** UI ********/

const heartRateEl=document.getElementById("heartRate")
const temperatureEl=document.getElementById("temperature")
const statusEl=document.getElementById("status")
const patientTitle=document.getElementById("patientTitle")

/******** DATA ********/

let labels=[]
let heartData=[]
let tempData=[]

let doctorEmail=""
let patientName=""

/******** EMAIL CONTROL ********/

let alertSent=false
let emergencyStartTime=null

const EMERGENCY_CONFIRM_TIME=5000

/******** PATIENT LOCATION ********/

function updatePatientLocation(){

if(!navigator.geolocation) return

navigator.geolocation.getCurrentPosition(function(position){

const lat=position.coords.latitude
const lng=position.coords.longitude

fetch(VITALS_URL,{
method:"PATCH",
headers:{ "Content-Type":"application/json"},
body:JSON.stringify({
lat:lat,
lng:lng
})
})

})

}

setInterval(updatePatientLocation,30000)

/******** LOAD DOCTOR ********/

fetch(DEVICE_URL)
.then(r=>r.json())
.then(d=>fetch(`${BASE_URL}/doctors/${d.assignedDoctor}.json`))
.then(r=>r.json())
.then(doc=>doctorEmail=doc.email)

/******** LOAD PATIENT ********/

fetch(PATIENT_URL)
.then(r=>r.json())
.then(p=>{

if(p && p.name){

patientName=p.name
patientTitle.innerHTML=`Patient: ${p.name}`

}

})

/******** CHARTS ********/

const heartCtx=document.getElementById("heartChart").getContext("2d")
const tempCtx=document.getElementById("tempChart").getContext("2d")

const heartChart=new Chart(heartCtx,{
type:"line",
data:{
labels:labels,
datasets:[{
data:heartData,
borderColor:"#fb7185",
fill:true
}]
},
options:{responsive:true,maintainAspectRatio:false}
})

const tempChart=new Chart(tempCtx,{
type:"line",
data:{
labels:labels,
datasets:[{
data:tempData,
borderColor:"#38bdf8",
fill:true
}]
},
options:{responsive:true,maintainAspectRatio:false}
})

/******** EMERGENCY CHECK ********/

function isEmergency(v){

return v.temperature>37 || v.temperature<33

}

/******** EMAIL ALERT ********/

function sendEmail(v){

const mapLink=`https://maps.google.com/?q=${v.lat || ""},${v.lng || ""}`

const templateParams={

patient:patientName,
heart:v.heartRate || 0,
temp:v.temperature || 0,
link:mapLink,
dashboard:"https://chaithra0926.github.io/remote-health-monitoring/",
to_email:doctorEmail

}

emailjs.send(SERVICE_ID,TEMPLATE_ID,templateParams)

.then(function(){

console.log("Email sent")

})

.catch(function(error){

console.log("Email error",error)

})

}

/******** MAIN LOOP ********/

setInterval(()=>{

fetch(VITALS_URL)

.then(r=>r.json())

.then(v=>{

if(!v) return

heartRateEl.innerHTML=`${v.heartRate || 0} <span>BPM</span>`
temperatureEl.innerHTML=`${v.temperature || 0} <span>°C</span>`

if(isEmergency(v)){

statusEl.textContent="EMERGENCY"
statusEl.style.color="#fb7185"

if(!emergencyStartTime){

emergencyStartTime=Date.now()

}

if(Date.now()-emergencyStartTime>=EMERGENCY_CONFIRM_TIME && !alertSent){

sendEmail(v)
alertSent=true

}

}else{

statusEl.textContent="NORMAL"
statusEl.style.color="#4ade80"

emergencyStartTime=null
alertSent=false

}

const time=new Date().toLocaleTimeString()

labels.push(time)
heartData.push(v.heartRate || 0)
tempData.push(v.temperature || 0)

if(labels.length>10){

labels.shift()
heartData.shift()
tempData.shift()

}

heartChart.update()
tempChart.update()

})

},1000)

/******** AMBULANCE DISPATCH ********/

const dispatchBtn=document.getElementById("dispatchBtn")

dispatchBtn.addEventListener("click",dispatchAmbulance)

function dispatchAmbulance(){

fetch(`${BASE_URL}/ambulances.json`)

.then(res=>res.json())

.then(data=>{

const ambulances=Object.entries(data)

for(let [id,amb] of ambulances){

if(amb.available){

alert("Ambulance contacted: "+amb.name)

fetch(`${BASE_URL}/ambulances/${id}.json`,{

method:"PATCH",
headers:{'Content-Type':'application/json'},
body:JSON.stringify({

available:false

})

})

return

}

}

alert("No ambulance available")

})

}
