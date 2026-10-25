
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQYvy84ib1bsk8ZCKOAffxbekyTYc3xsudJdW0gNz8LHyjzPK2Y-N88Xmo_c8ZN6LpIGwvdrgHG4s3z/pub?gid=1754684221&single=true&output=csv";

const SELECTED_WEEKDAY = "Monday";
const SELECTED_TIME = "10:00";

let floors = [];
let selectedFloor = 0;
let selectedArea = 0;

const closingTimes = {
    5: "17:00",
    4: "18:00",
    3: "19:00",
    2: "20:00",
    1: "21:00"
};

function timeToMinutes(time) {
    const match = String(time).match(/^(\d{1,2}):(\d{2})$/);

    if (!match) return -1;

    return Number(match[1]) * 60 + Number(match[2]);
}

function normalizeTime(time) {
    const minutes = timeToMinutes(time);

    if (minutes < 0) return "";

    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function formatTime(time) {
    const minutes = timeToMinutes(time);

    if (minutes < 0) return time;

    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    return `${hours % 12 || 12}:${String(mins).padStart(2, "0")} ${hours >= 12 ? "PM" : "AM"}`;
}

function isFloorClosed(floorName, time = SELECTED_TIME) {
    const floorNumber = Number(floorName.match(/\d+/)?.[0]);
    const closingTime = closingTimes[floorNumber];

    return closingTime
        ? timeToMinutes(time) >= timeToMinutes(closingTime)
        : false;
}

function parseCSV(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const next = text[i + 1];

        if (char === '"' && quoted && next === '"') {
            cell += '"';
            i++;
        } else if (char === '"') {
            quoted = !quoted;
        } else if (char === "," && !quoted) {
            row.push(cell.trim());
            cell = "";
        } else if ((char === "\n" || char === "\r") && !quoted) {
            if (char === "\r" && next === "\n") i++;

            row.push(cell.trim());

            if (row.some(value => value !== "")) rows.push(row);

            row = [];
            cell = "";
        } else {
            cell += char;
        }
    }

    row.push(cell.trim());

    if (row.some(value => value !== "")) rows.push(row);

    return rows;
}

async function fetchOccupancyData() {
    const response = await fetch(CSV_URL);

    if (!response.ok) {
        throw new Error(`CSV request failed: ${response.status}`);
    }

    const rows = parseCSV(await response.text());

    if (rows.length < 2) {
        throw new Error("No occupancy records were found in the CSV.");
    }

    const headers = rows[0].map(value =>
        value.replace(/^\uFEFF/, "").trim().toLowerCase()
    );

    const column = name => headers.indexOf(name.toLowerCase());

    const weekdayIndex = column("Weekday");
    const timeIndex = column("Time Recorded");
    const floorIndex = column("Floor");
    const areaIndex = column("Study Area");
    const totalIndex = column("Total Seats");
    const occupiedIndex = column("Occupied Seats");

    const indexes = [
        weekdayIndex,
        timeIndex,
        floorIndex,
        areaIndex,
        totalIndex,
        occupiedIndex
    ];

    if (indexes.some(index => index < 0)) {
        throw new Error(`Unexpected CSV headers: ${headers.join(", ")}`);
    }

    let lastWeekday = "";

    return rows.slice(1).map(row => {
        const weekday = row[weekdayIndex]?.trim();

        if (weekday) lastWeekday = weekday;

        return {
            weekday: lastWeekday,
            time: normalizeTime(row[timeIndex]?.trim()),
            floor: Number(row[floorIndex]),
            name: row[areaIndex]?.trim() || "",
            total: Number(row[totalIndex]),
            occupied: Number(row[occupiedIndex])
        };
    }).filter(record =>
        record.weekday &&
        record.time &&
        Number.isInteger(record.floor) &&
        record.name &&
        Number.isFinite(record.total) &&
        Number.isFinite(record.occupied) &&
        record.total > 0 &&
        record.occupied >= 0 &&
        record.occupied <= record.total
    );
}

function buildFloors(records) {
    const targetTime = timeToMinutes(SELECTED_TIME);
    const selectedDay = SELECTED_WEEKDAY.trim().toLowerCase();
    const latestRecords = new Map();

    records.filter(record =>
        record.weekday.trim().toLowerCase() === selectedDay &&
        timeToMinutes(record.time) <= targetTime
    ).forEach(record => {
        const key = `${record.floor}|${record.name.toLowerCase()}`;
        const previous = latestRecords.get(key);

        if (
            !previous ||
            timeToMinutes(record.time) > timeToMinutes(previous.time)
        ) {
            latestRecords.set(key, record);
        }
    });

    const floorMap = new Map();

    for (const record of latestRecords.values()) {
        if (!floorMap.has(record.floor)) {
            floorMap.set(record.floor, {
                name: `Floor ${record.floor}`,
                areas: []
            });
        }

        floorMap.get(record.floor).areas.push({
            name: record.name,
            occupied: record.occupied,
            total: record.total,
            time: record.time
        });
    }

    return [...floorMap.values()].sort((a, b) => a.floorNumber - b.floorNumber);
}

function updateSummary() {
    const overallOccupancy = document.getElementById("overall-occupancy");
    const overallProgress = document.getElementById("overall-progress");
    const seatSummary = document.getElementById("seat-summary");

    const busiestArea = document.getElementById("busiest-area");
    const busiestFloor = document.getElementById("busiest-floor");
    const busiestRate = document.getElementById("busiest-rate");

    const freestArea = document.getElementById("freest-area");
    const freestFloor = document.getElementById("freest-floor");
    const freestRate = document.getElementById("freest-rate");

    let occupiedTotal = 0;
    let seatTotal = 0;
    let busiest = null;
    let freest = null;

    floors.forEach(floor => {
        if (isFloorClosed(floor.name)) return;

        floor.areas.forEach(area => {
            const rate = area.occupied / area.total * 100;

            occupiedTotal += area.occupied;
            seatTotal += area.total;

            const item = { ...area, floor: floor.name, rate };

            if (!busiest || rate > busiest.rate) busiest = item;
            if (!freest || rate < freest.rate) freest = item;
        });
    });

    const percentage = seatTotal
        ? occupiedTotal / seatTotal * 100
        : 0;

    overallOccupancy.textContent = seatTotal
        ? `${percentage.toFixed(1)}%`
        : "—";

    overallProgress.style.width = `${percentage}%`;

    seatSummary.textContent = seatTotal
        ? `${occupiedTotal} of ${seatTotal} seats occupied across open floors`
        : "No open-floor data available at this time.";

    busiestArea.textContent = busiest ? busiest.name : "—";
    busiestFloor.textContent = busiest
        ? `${busiest.floor} - ${busiest.occupied} of ${busiest.total} seats`
        : "No data available";
    busiestRate.textContent = busiest
        ? `${busiest.rate.toFixed(1)}% occupied`
        : "";

    freestArea.textContent = freest ? freest.name : "—";
    freestFloor.textContent = freest
        ? `${freest.floor} - ${freest.occupied} of ${freest.total} seats`
        : "No data available";
    freestRate.textContent = freest
        ? `${freest.rate.toFixed(1)}% occupied`
        : "";
}

function renderAreaDetails(floor, area) {
    const details = document.getElementById("area-details");

    if (isFloorClosed(floor.name)) {
        const number = Number(floor.name.match(/\d+/)?.[0]);

        details.innerHTML = `
            <div class="closed-card">
                <div class="closed-message">
                    <span class="closed-indicator"></span>
                    <strong>This floor is closed.</strong>
                </div>
                <p class="closed-description">
                    This floor closes at ${formatTime(closingTimes[number])}.
                    Its occupancy is excluded from the overall summary.
                </p>
            </div>
        `;

        return;
    }

    if (!area) {
        details.innerHTML = "<p>No study-area data available.</p>";
        return;
    }

    const rate = area.occupied / area.total * 100;
    const available = area.total - area.occupied;

    let status = "Available";
    let color = "green";

    if (rate >= 80) {
        status = "Almost full";
        color = "red";
    } else if (rate >= 50) {
        status = "Getting busy";
        color = "gold";
    }

    details.innerHTML = `
        <div class="area-card">
            <p class="area-floor">${floor.name}</p>
            <h3>${area.name}</h3>

            <div class="occupancy-heading">
                <span>Seat occupancy</span>
                <strong>${rate.toFixed(1)}%</strong>
            </div>

            <div class="progress">
                <div class="progress-fill ${color}"
                     style="width: ${rate}%"></div>
            </div>

            <div class="area-stats">
                <div class="mini-stat">
                    <span>Total seats</span>
                    <strong>${area.total}</strong>
                </div>
                <div class="mini-stat">
                    <span>Occupied</span>
                    <strong>${area.occupied}</strong>
                </div>
                <div class="mini-stat">
                    <span>Available</span>
                    <strong>${available}</strong>
                </div>
            </div>

            <span class="occupancy-status ${color}">${status}</span>
            <p class="closed-description">
                Last recorded at ${formatTime(area.time)}.
            </p>
        </div>
    `;
}

function render() {
    const floorTabs = document.getElementById("floor-tabs");
    const areaTabs = document.getElementById("area-tabs");
    const floorTitle = document.getElementById("selected-floor-title");
    const areaCount = document.getElementById("area-count");
    const timestamp = document.getElementById("data-timestamp");

    timestamp.textContent =
        `Showing ${SELECTED_WEEKDAY} - ${formatTime(SELECTED_TIME)}`;

    floorTabs.innerHTML = "";
    areaTabs.innerHTML = "";

    if (floors.length === 0) {
        floorTitle.textContent = "No data";
        areaCount.textContent = "0 study areas";

        document.getElementById("area-details").innerHTML = `
            <p>No records found for ${SELECTED_WEEKDAY} at or before
            ${formatTime(SELECTED_TIME)}. Check the selected day and time.</p>
        `;

        updateSummary();
        return;
    }

    selectedFloor = Math.min(selectedFloor, floors.length - 1);

    floors.forEach((floor, index) => {
        const button = document.createElement("button");
        const closed = isFloorClosed(floor.name);

        button.className = index === selectedFloor ? "tab active" : "tab";
        button.textContent = closed ? `${floor.name} - Closed` : floor.name;

        button.onclick = () => {
            selectedFloor = index;
            selectedArea = 0;
            render();
        };

        floorTabs.appendChild(button);
    });

    const floor = floors[selectedFloor];
    const closed = isFloorClosed(floor.name);

    floorTitle.textContent = floor.name;
    areaCount.textContent = closed
        ? "Floor closed"
        : `${floor.areas.length} study area${floor.areas.length === 1 ? "" : "s"}`;

    if (!closed) {
        selectedArea = Math.min(
            selectedArea,
            Math.max(0, floor.areas.length - 1)
        );

        floor.areas.forEach((area, index) => {
            const button = document.createElement("button");

            button.className = index === selectedArea
                ? "area-tab active"
                : "area-tab";

            button.textContent = area.name;

            button.onclick = () => {
                selectedArea = index;
                render();
            };

            areaTabs.appendChild(button);
        });
    }

    renderAreaDetails(floor, closed ? null : floor.areas[selectedArea]);
    updateSummary();
}

async function loadLiveRARY() {
    const details = document.getElementById("area-details");

    details.innerHTML = "<p>Loading occupancy data.</p>";

    try {
        const records = await fetchOccupancyData();
        floors = buildFloors(records);
        selectedFloor = 0;
        selectedArea = 0;
        render();
    } catch (error) {
        console.error("LiveRARY loading error:", error);

        details.innerHTML = `
            <p>Unable to load occupancy data.</p>
            <p>${error.message}</p>
        `;
    }
}

document.addEventListener("DOMContentLoaded", loadLiveRARY);
