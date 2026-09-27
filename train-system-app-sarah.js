// Show sections
function showSectionSoso(sectionId){
  let sections = document.getElementsByClassName("section");
  for(let i = 0; i < sections.length; i++){
    sections[i].style.display = "none";
  }
  document.getElementById(sectionId).style.display = "block";
}

// Add schedule
function addScheduleSoso(){
  let train = document.getElementById("train").value;
  if(train === ""){
    document.getElementById("output").innerText = "Enter train name!";
    return;
  }
  document.getElementById("output").innerText = "Schedule added for " + train;
}

// Add route & time
function addRouteSoso() {
  let route = document.getElementById("routeInput").value;
  let time = document.getElementById("timeInput").value;

  if(route === "" || time === ""){
    document.getElementById("output").innerText = "Please fill all fields!";
    return;
  }

  if(!time.includes(":")){
    document.getElementById("output").innerText = "Invalid time format!";
    return;
  }

  document.getElementById("output").innerText =
  "Route: " + route + " | Time: " + time;
}

// Set capacity
function setCapacitySoso(){
  let cap = document.getElementById("cap").value;
  if(cap <= 0){
    document.getElementById("output").innerText = "Invalid capacity!";
    return;
  }
  document.getElementById("output").innerText = "Capacity set to " + cap;
}
