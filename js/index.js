const floors = [
    {
        name: "Floor 1",
        areas: [
            { name: "Resu", occupied: 10, total: 30 },
            { name: "Lobby", occupied: 23, total: 25 }
        ]
    },
    {
        name: "Floor 2",
        areas: [
            { name: "Computer Laboratory", occupied: 24, total: 35 }
        ]
    },
    {
        name: "Floor 3",
        areas: [
            { name: "Individual Study Area", occupied: 20, total: 30 },
            { name: "Computer Laboratory", occupied: 16, total: 25 }
        ]
    },
    {
        name: "Floor 4",
        areas: [
            { name: "Individual Study Area", occupied: 14, total: 30 }
        ]
    },
    {
        name: "Floor 5",
        areas: [
            { name: "Open Study Area", occupied: 10, total: 35 }
        ]
    }
];

let selectedFloor = 0;
let selectedArea = 0;

const floorTabs = document.getElementById("floor-tabs");
const areaTabs = document.getElementById("area-tabs");
const areaDetails = document.getElementById("area-details");

function render() {
    floorTabs.innerHTML = "";
    areaTabs.innerHTML = "";

    floors.forEach((floor, i) => {
        const button = document.createElement("button");
        button.textContent = floor.name;
        button.className = i === selectedFloor ? "tab active" : "tab";

        button.onclick = () => {
            selectedFloor = i;
            selectedArea = 0;
            render();
        };

        floorTabs.appendChild(button);
    });

    const floor = floors[selectedFloor];

    document.getElementById("selected-floor-title").textContent = floor.name;
    document.getElementById("area-count").textContent =
        `${floor.areas.length} study ${floor.areas.length === 1 ? "area" : "areas"}`;

    floor.areas.forEach((area, i) => {
        const button = document.createElement("button");
        button.textContent = area.name;
        button.className = i === selectedArea ? "area-tab active" : "area-tab";

        button.onclick = () => {
            selectedArea = i;
            render();
        };

        areaTabs.appendChild(button);
    });

    const area = floor.areas[selectedArea];
    const percent = Math.round(area.occupied / area.total * 100);
    const available = area.total - area.occupied;

    let color = "green";
    let level = "Low occupancy";

    if (percent >= 80) {
        color = "red";
        level = "High occupancy";
    } else if (percent >= 50) {
        color = "gold";
        level = "Moderate occupancy";
    }

    areaDetails.innerHTML = `
        <div class="area-card">
            <p class="area-floor">${floor.name}</p>
            <h3>${area.name}</h3>

            <div class="occupancy-heading">
                <span>Current occupancy</span>
                <strong>${percent}%</strong>
            </div>

            <div class="progress">
                <div class="progress-fill ${color}" style="width: ${percent}%"></div>
            </div>

            <div class="area-stats">
                <div class="mini-stat">
                    <span>Occupied seats</span>
                    <strong>${area.occupied}</strong>
                </div>
                <div class="mini-stat">
                    <span>Available seats</span>
                    <strong>${available}</strong>
                </div>
                <div class="mini-stat">
                    <span>Total seats</span>
                    <strong>${area.total}</strong>
                </div>
            </div>

            <span class="occupancy-status ${color}">${level}</span>
        </div>
    `;

    let totalOccupied = 0;
    let totalSeats = 0;
    let busiest = null;
    let freest = null;

    floors.forEach(floor => {
        floor.areas.forEach(area => {
            const rate = area.occupied / area.total * 100;

            totalOccupied += area.occupied;
            totalSeats += area.total;

            if (!busiest || rate > busiest.rate) {
                busiest = { ...area, floor: floor.name, rate };
            }

            if (!freest || rate < freest.rate) {
                freest = { ...area, floor: floor.name, rate };
            }
        });
    });

    const overall = Math.round(totalOccupied / totalSeats * 100);

    document.getElementById("overall-occupancy").textContent = `${overall}%`;
    document.getElementById("overall-progress").style.width = `${overall}%`;
    document.getElementById("seat-summary").textContent =
        `${totalSeats - totalOccupied} seats available out of ${totalSeats}`;

    document.getElementById("busiest-area").textContent = busiest.name;
    document.getElementById("busiest-floor").textContent =
        `${busiest.floor} · ${busiest.total - busiest.occupied} seats available`;
    document.getElementById("busiest-rate").textContent =
        `${Math.round(busiest.rate)}% occupied`;

    document.getElementById("freest-area").textContent = freest.name;
    document.getElementById("freest-floor").textContent =
        `${freest.floor} · ${freest.total - freest.occupied} seats available`;
    document.getElementById("freest-rate").textContent =
        `${Math.round(freest.rate)}% occupied`;

    document.getElementById("study-tip").textContent =
        `Try the ${freest.name} on ${freest.floor} for the lowest occupancy.`;
}

render();