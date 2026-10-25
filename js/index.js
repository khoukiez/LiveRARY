const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQYvy84ib1bsk8ZCKOAffxbekyTYc3xsudJdW0gNz8LHyjzPK2Y-N88Xmo_c8ZN6LpIGwvdrgHG4s3z/pub?gid=1754684221&single=true&output=csv";

const TIME_ZONE = "Asia/Manila";
const REFRESH_INTERVAL = 60 * 1000;

const FLOOR_CLOSING_TIMES = {
    1: "21:00",
    2: "20:00",
    3: "19:00",
    4: "18:00",
    5: "17:00"
};

let floors = [];
let selectedFloor = 1;
let selectedArea = null;
let lastUpdatedTime = null;

function getPhilippineDateTime() {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        weekday: "long",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
    }).formatToParts(new Date());

    const values = {};

    parts.forEach(part => {
        values[part.type] = part.value;
    });

    return {
        weekday: values.weekday,
        date: `${values.year}-${values.month}-${values.day}`,
        minutes: Number(values.hour) * 60 + Number(values.minute),
        time: `${values.hour}:${values.minute}`
    };
}

function timeToMinutes(time) {
    if (!time) return null;

    const normalized = String(time).trim().toUpperCase();

    const match = normalized.match(
        /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/
    );

    if (!match) return null;

    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    const period = match[3];

    if (minutes > 59) return null;

    if (period) {
        if (hours < 1 || hours > 12) return null;

        if (period === "AM" && hours === 12) hours = 0;
        if (period === "PM" && hours !== 12) hours += 12;
    } else if (hours > 23) {
        return null;
    }

    return hours * 60 + minutes;
}

function formatTime(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function isFloorClosed(floorNumber, currentMinutes) {
    const closingTime = timeToMinutes(
        FLOOR_CLOSING_TIMES[floorNumber]
    );

    return closingTime !== null && currentMinutes >= closingTime;
}

function parseCSVLine(line) {
    const result = [];
    let value = "";
    let insideQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const character = line[i];

        if (character === '"') {
            if (insideQuotes && line[i + 1] === '"') {
                value += '"';
                i++;
            } else {
                insideQuotes = !insideQuotes;
            }
        } else if (character === "," && !insideQuotes) {
            result.push(value.trim());
            value = "";
        } else {
            value += character;
        }
    }

    result.push(value.trim());

    return result;
}

function parseCSV(text) {
    const lines = text
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .filter(line => line.trim() !== "");

    if (lines.length < 2) {
        throw new Error("The spreadsheet contains no occupancy records.");
    }

    const headers = parseCSVLine(lines[0]).map(header =>
        header.trim().toLowerCase()
    );

    const requiredHeaders = [
        "weekday",
        "time recorded",
        "floor",
        "study area",
        "total seats",
        "occupied seats"
    ];

    const indexes = {};

    requiredHeaders.forEach(header => {
        indexes[header] = headers.indexOf(header);

        if (indexes[header] === -1) {
            throw new Error(`Missing spreadsheet column: ${header}`);
        }
    });

    const records = [];
    let previousWeekday = "";

    for (let i = 1; i < lines.length; i++) {
        const columns = parseCSVLine(lines[i]);

        let weekday = columns[indexes["weekday"]] || "";

        if (weekday) {
            previousWeekday = weekday;
        } else {
            weekday = previousWeekday;
        }

        const timeRecorded = columns[indexes["time recorded"]];
        const floor = Number(columns[indexes["floor"]]);
        const studyArea = columns[indexes["study area"]];
        const totalSeats = Number(columns[indexes["total seats"]]);
        const occupiedSeats = Number(columns[indexes["occupied seats"]]);

        if (
            !weekday ||
            !timeRecorded ||
            !Number.isInteger(floor) ||
            !studyArea ||
            !Number.isFinite(totalSeats) ||
            !Number.isFinite(occupiedSeats) ||
            totalSeats < 0 ||
            occupiedSeats < 0
        ) {
            continue;
        }

        const minutes = timeToMinutes(timeRecorded);

        if (minutes === null) continue;

        records.push({
            weekday: weekday.trim().toLowerCase(),
            time: minutes,
            floor,
            area: studyArea.trim(),
            total: totalSeats,
            occupied: occupiedSeats
        });
    }

    return records;
}

async function fetchOccupancyData() {
    const response = await fetch(
        `${CSV_URL}${CSV_URL.includes("?") ? "&" : "?"}refresh=${Date.now()}`
    );

    if (!response.ok) {
        throw new Error("Could not retrieve the Google Sheets data.");
    }

    const csvText = await response.text();

    return parseCSV(csvText);
}

function buildFloors(records, currentTime) {
    const weekday = currentTime.weekday.toLowerCase();

    const todayRecords = records.filter(record =>
        record.weekday === weekday &&
        record.time <= currentTime.minutes
    );

    const latestRecords = new Map();

    todayRecords.forEach(record => {
        const key = `${record.floor}|${record.area}`;
        const existing = latestRecords.get(key);

        if (!existing || record.time >= existing.time) {
            latestRecords.set(key, record);
        }
    });

    const groupedFloors = new Map();

    latestRecords.forEach(record => {
        if (!groupedFloors.has(record.floor)) {
            groupedFloors.set(record.floor, {
                floorNumber: record.floor,
                areas: [],
                lastRecorded: record.time
            });
        }

        const floor = groupedFloors.get(record.floor);

        floor.areas.push({
            name: record.area,
            occupied: record.occupied,
            total: record.total,
            time: record.time
        });

        floor.lastRecorded = Math.max(
            floor.lastRecorded,
            record.time
        );
    });

    return Array.from(groupedFloors.values())
        .sort((a, b) => a.floorNumber - b.floorNumber)
        .map(floor => ({
            ...floor,
            closed: isFloorClosed(
                floor.floorNumber,
                currentTime.minutes
            ),
            areas: floor.areas.sort((a, b) =>
                a.name.localeCompare(b.name)
            )
        }));
}

function updateSummary() {
    const openAreas = floors
        .filter(floor => !floor.closed)
        .flatMap(floor =>
            floor.areas
                .filter(area => area.total > 0)
                .map(area => ({
                    ...area,
                    floorNumber: floor.floorNumber
                }))
        );

    const totalSeats = openAreas.reduce(
        (sum, area) => sum + area.total,
        0
    );

    const occupiedSeats = openAreas.reduce(
        (sum, area) => sum + Math.min(area.occupied, area.total),
        0
    );

    const occupancy = totalSeats
        ? Math.round((occupiedSeats / totalSeats) * 100)
        : 0;

    document.getElementById("overall-occupancy").textContent =
        `${occupancy}%`;

    document.getElementById("overall-progress").style.width =
        `${occupancy}%`;

    document.getElementById("seat-summary").textContent =
        totalSeats
            ? `${occupiedSeats} of ${totalSeats} seats occupied across open floors.`
            : "No occupancy data available for open floors yet.";

    if (openAreas.length === 0) {
        document.getElementById("busiest-area").textContent = "—";
        document.getElementById("busiest-floor").textContent = "";
        document.getElementById("busiest-rate").textContent = "";
        document.getElementById("freest-area").textContent = "—";
        document.getElementById("freest-floor").textContent = "";
        document.getElementById("freest-rate").textContent = "";
        return;
    }

    const rankedAreas = openAreas
        .map(area => ({
            ...area,
            rate: area.occupied / area.total
        }))
        .sort((a, b) => b.rate - a.rate);

    const busiest = rankedAreas[0];
    const freest = rankedAreas[rankedAreas.length - 1];

    document.getElementById("busiest-area").textContent =
        busiest.name;

    document.getElementById("busiest-floor").textContent =
        `Floor ${busiest.floorNumber}`;

    document.getElementById("busiest-rate").textContent =
        `${Math.round(busiest.rate * 100)}% occupied`;

    document.getElementById("freest-area").textContent =
        freest.name;

    document.getElementById("freest-floor").textContent =
        `Floor ${freest.floorNumber}`;

    document.getElementById("freest-rate").textContent =
        `${Math.round(freest.rate * 100)}% occupied`;
}

function renderAreaDetails(floor) {
    const container = document.getElementById("area-details");

    if (floor.closed) {
        container.innerHTML = `
            <div class="closed-card">
                <p class="closed-message">This floor is closed.</p>
                <p class="closed-indicator">Floor ${floor.floorNumber}</p>
                <p class="closed-description">
                    Closing time: ${formatTime(
                        timeToMinutes(FLOOR_CLOSING_TIMES[floor.floorNumber])
                    )}
                </p>
            </div>
        `;
        return;
    }

    if (floor.areas.length === 0) {
        container.innerHTML = `
            <div class="closed-card">
                <p class="closed-message">No data available yet.</p>
                <p class="closed-description">
                    No records have been entered for this floor today
                    at or before the current time.
                </p>
            </div>
        `;
        return;
    }

    const area = floor.areas.find(item => item.name === selectedArea)
        || floor.areas[0];

    selectedArea = area.name;

    if (area.total <= 0) {
        container.innerHTML = `
            <div class="area-card">
                <h3>${area.name}</h3>
                <p class="occupancy-status">Seat capacity unavailable.</p>
            </div>
        `;
        return;
    }

    const occupied = Math.min(area.occupied, area.total);
    const available = Math.max(area.total - occupied, 0);
    const percentage = Math.round((occupied / area.total) * 100);

    let color = "green";
    let status = "Plenty of seats available";

    if (percentage >= 80) {
        color = "red";
        status = "Almost full";
    } else if (percentage >= 50) {
        color = "gold";
        status = "Getting busy";
    }

    container.innerHTML = `
        <div class="area-card">
            <p class="area-floor">FLOOR ${floor.floorNumber}</p>
            <h3>${area.name}</h3>

            <div class="occupancy-heading">
                <span>Occupancy</span>
                <strong>${percentage}%</strong>
            </div>

            <div class="progress">
                <div class="progress-fill ${color}"
                     style="width: ${percentage}%"></div>
            </div>

            <div class="area-stats">
                <div class="mini-stat">
                    <span>Occupied</span>
                    <strong>${occupied}</strong>
                </div>
                <div class="mini-stat">
                    <span>Available</span>
                    <strong>${available}</strong>
                </div>
                <div class="mini-stat">
                    <span>Total seats</span>
                    <strong>${area.total}</strong>
                </div>
            </div>

            <p class="occupancy-status">${status}</p>
            <p class="muted">
                Last recorded: ${formatTime(area.time)}
            </p>
        </div>
    `;
}

function render(currentTime) {
    const floorTabs = document.getElementById("floor-tabs");
    const areaTabs = document.getElementById("area-tabs");

    document.getElementById("data-timestamp").textContent =
        `Today: ${currentTime.weekday}, ${currentTime.time} (Philippine time)`;

    floorTabs.innerHTML = "";

    if (floors.length === 0) {
        document.getElementById("selected-floor-title").textContent =
            "No data available";

        document.getElementById("area-count").textContent = "0 study areas";
        areaTabs.innerHTML = "";

        document.getElementById("area-details").innerHTML = `
            <div class="closed-card">
                <p class="closed-message">No occupancy records yet.</p>
                <p class="closed-description">
                    Check whether today's data has been added to the spreadsheet.
                </p>
            </div>
        `;

        updateSummary();
        return;
    }

    floors.forEach(floor => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "tab";

        if (floor.floorNumber === selectedFloor) {
            button.classList.add("active");
        }

        button.textContent = `Floor ${floor.floorNumber}${
            floor.closed ? " · Closed" : ""
        }`;

        button.addEventListener("click", () => {
            selectedFloor = floor.floorNumber;
            selectedArea = null;
            render(currentTime);
        });

        floorTabs.appendChild(button);
    });

    let floor = floors.find(
        item => item.floorNumber === selectedFloor
    );

    if (!floor) {
        floor = floors[0];
        selectedFloor = floor.floorNumber;
    }

    document.getElementById("selected-floor-title").textContent =
        `Floor ${floor.floorNumber}`;

    document.getElementById("area-count").textContent =
        `${floor.areas.length} study area${floor.areas.length === 1 ? "" : "s"}`;

    areaTabs.innerHTML = "";

    if (!floor.closed) {
        floor.areas.forEach(area => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "area-tab";

            if (area.name === selectedArea) {
                button.classList.add("active");
            }

            button.textContent = area.name;

            button.addEventListener("click", () => {
                selectedArea = area.name;
                render(currentTime);
            });

            areaTabs.appendChild(button);
        });
    }

    renderAreaDetails(floor);
    updateSummary();
}

async function loadLiveRARY() {
    const currentTime = getPhilippineDateTime();

    try {
        const records = await fetchOccupancyData();

        floors = buildFloors(records, currentTime);
        lastUpdatedTime = new Date();

        render(currentTime);
    } catch (error) {
        console.error("LiveRARY error:", error);

        document.getElementById("data-timestamp").textContent =
            "Unable to load occupancy data. Please check the CSV link.";

        document.getElementById("area-details").innerHTML = `
            <div class="closed-card">
                <p class="closed-message">Unable to load data.</p>
                <p class="closed-description">
                    Check your published Google Sheets CSV link and internet connection.
                </p>
            </div>
        `;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    loadLiveRARY();

    setInterval(() => {
        loadLiveRARY();
    }, REFRESH_INTERVAL);
});
