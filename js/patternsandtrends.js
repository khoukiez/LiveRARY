
const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQYvy84ib1bsk8ZCKOAffxbekyTYc3xsudJdW0gNz8LHyjzPK2Y-N88Xmo_c8ZN6LpIGwvdrgHG4s3z/pub?gid=1754684221&single=true&output=csv";

const weekdays = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday"
];

let allRecords = [];

const weekdaySelect = document.getElementById("weekday-select");
const floorSelect = document.getElementById("floor-select");
const areaSelect = document.getElementById("area-select");
const statusText = document.getElementById("data-status");

function parseCSV(csv) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;

    for (let i = 0; i < csv.length; i++) {
        const char = csv[i];

        if (char === '"') {
            if (quoted && csv[i + 1] === '"') {
                field += '"';
                i++;
            } else {
                quoted = !quoted;
            }
        } else if (char === "," && !quoted) {
            row.push(field.trim());
            field = "";
        } else if ((char === "\n" || char === "\r") && !quoted) {
            if (char === "\r" && csv[i + 1] === "\n") i++;

            row.push(field.trim());

            if (row.some(value => value !== "")) {
                rows.push(row);
            }

            row = [];
            field = "";
        } else {
            field += char;
        }
    }

    row.push(field.trim());

    if (row.some(value => value !== "")) {
        rows.push(row);
    }

    return rows;
}

async function fetchRecords() {
    const response = await fetch(SHEET_URL);

    if (!response.ok) {
        throw new Error(`CSV request failed: ${response.status}`);
    }

    const rows = parseCSV(await response.text());

    if (rows.length < 2) {
        throw new Error("No records were found in the spreadsheet.");
    }

    const headers = rows[0].map(value =>
        value.trim().replace(/^\uFEFF/, "").toLowerCase()
    );

    const col = name => headers.indexOf(name.toLowerCase());

    const timeIndex = col("Time Recorded");
    const floorIndex = col("Floor");
    const areaIndex = col("Study Area");
    const totalIndex = col("Total Seats");
    const occupiedIndex = col("Occupied Seats");

    if ([timeIndex, floorIndex, areaIndex, totalIndex, occupiedIndex].includes(-1)) {
        throw new Error("Check the CSV column headers.");
    }

    return rows.slice(1)
        .map((row, index) => ({
            day: (row[timeIndex] || "").trim(),
            floor: Number(row[floorIndex]),
            name: (row[areaIndex] || "").trim(),
            total: Number(row[totalIndex]),
            occupied: Number(row[occupiedIndex]),
            order: index
        }))
        .filter(record =>
            weekdays.some(day => day.toLowerCase() === record.day.toLowerCase()) &&
            Number.isInteger(record.floor) &&
            record.floor >= 1 &&
            record.name &&
            Number.isFinite(record.total) &&
            Number.isFinite(record.occupied) &&
            record.total > 0 &&
            record.occupied >= 0 &&
            record.occupied <= record.total
        )
        .map(record => ({
            ...record,
            day: weekdays.find(day => day.toLowerCase() === record.day.toLowerCase())
        }));
}

function latestPerArea(records) {
    const latest = new Map();

    records.forEach(record => {
        const key = `${record.day}|${record.floor}|${record.name.toLowerCase()}`;
        latest.set(key, record);
    });

    return [...latest.values()];
}

function getFilteredRecords() {
    let records = latestPerArea(allRecords);

    if (weekdaySelect.value !== "All") {
        records = records.filter(record => record.day === weekdaySelect.value);
    }

    if (floorSelect.value !== "All") {
        records = records.filter(record => record.floor === Number(floorSelect.value));
    }

    return records;
}

function occupancy(record) {
    return record.occupied / record.total * 100;
}

function setText(id, value) {
    document.getElementById(id).textContent = value;
}

function renderSummary(records) {
    if (!records.length) {
        setText("average-occupancy", "—");
        setText("busiest-area", "—");
        setText("busiest-detail", "No data available");
        setText("freest-area", "—");
        setText("freest-detail", "No data available");
        setText("areas-count", "0");
        return;
    }

    const average = records.reduce((sum, record) =>
        sum + occupancy(record), 0) / records.length;

    const busiest = records.reduce((best, record) =>
        occupancy(record) > occupancy(best) ? record : best
    );

    const freest = records.reduce((best, record) =>
        occupancy(record) < occupancy(best) ? record : best
    );

    setText("average-occupancy", `${Math.round(average)}%`);
    setText("busiest-area", busiest.name);
    setText("busiest-detail",
        `Floor ${busiest.floor} · ${Math.round(occupancy(busiest))}% occupied`
    );
    setText("freest-area", freest.name);
    setText("freest-detail",
        `Floor ${freest.floor} · ${Math.round(occupancy(freest))}% occupied`
    );
    setText("areas-count", records.length);
}

function renderOccupancyChart(records) {
    const container = document.getElementById("occupancy-chart");
    container.replaceChildren();

    if (!records.length) {
        container.innerHTML = '<p class="empty-state">No records for these filters.</p>';
        return;
    }

    records.sort((a, b) => occupancy(b) - occupancy(a));

    records.forEach(record => {
        const percent = occupancy(record);

        const row = document.createElement("div");
        row.className = "bar-row";

        const label = document.createElement("div");
        label.className = "bar-label";
        label.textContent = `F${record.floor} · ${record.name}`;

        const track = document.createElement("div");
        track.className = "bar-track";

        const fill = document.createElement("div");
        fill.className = "bar-fill";
        if (percent >= 80) fill.classList.add("high");
        else if (percent >= 50) fill.classList.add("moderate");
        fill.style.width = `${percent}%`;
        fill.title = `${percent.toFixed(1)}% occupied`;

        track.appendChild(fill);

        const value = document.createElement("div");
        value.className = "bar-value";
        value.textContent = `${Math.round(percent)}%`;

        row.append(label, track, value);
        container.appendChild(row);
    });
}

function populateAreaSelect() {
    const previousValue = areaSelect.value;
    const names = [...new Set(
        allRecords.map(record => `${record.floor}|${record.name}`)
    )].sort((a, b) => a.localeCompare(b));

    areaSelect.replaceChildren();

    names.forEach(key => {
        const [floor, name] = key.split("|");
        const option = document.createElement("option");
        option.value = key;
        option.textContent = `Floor ${floor} · ${name}`;
        areaSelect.appendChild(option);
    });

    if (names.includes(previousValue)) {
        areaSelect.value = previousValue;
    }
}

function renderWeekdayChart() {
    const container = document.getElementById("weekday-chart");
    const note = document.getElementById("trend-note");
    container.replaceChildren();

    const key = areaSelect.value;

    if (!key) {
        container.innerHTML = '<p class="empty-state">No study areas available.</p>';
        note.textContent = "";
        return;
    }

    const [floor, ...nameParts] = key.split("|");
    const name = nameParts.join("|");

    const values = weekdays.map(day => {
        const record = latestPerArea(allRecords).find(item =>
            item.day === day &&
            item.floor === Number(floor) &&
            item.name === name
        );

        return {
            day,
            record,
            percent: record ? occupancy(record) : null
        };
    });

    values.forEach(item => {
        const column = document.createElement("div");
        column.className = "weekday-column";

        const value = document.createElement("span");
        value.className = "weekday-value";
        value.textContent = item.percent === null
            ? "—"
            : `${Math.round(item.percent)}%`;

        const track = document.createElement("div");
        track.className = "weekday-track";

        const fill = document.createElement("div");
        fill.className = "weekday-fill";
        fill.style.height = item.percent === null ? "0%" : `${item.percent}%`;

        if (item.percent !== null) {
            fill.title = `${item.day}: ${item.percent.toFixed(1)}%`;
        }

        track.appendChild(fill);

        const label = document.createElement("span");
        label.className = "weekday-label";
        label.textContent = item.day.slice(0, 3);

        column.append(value, track, label);
        container.appendChild(column);
    });

    const availableValues = values.filter(item => item.percent !== null);

    if (availableValues.length < 2) {
        note.textContent =
            "At least two weekdays with recorded data are needed to compare weekday differences.";
        return;
    }

    const highest = availableValues.reduce((a, b) =>
        a.percent > b.percent ? a : b
    );

    const lowest = availableValues.reduce((a, b) =>
        a.percent < b.percent ? a : b
    );

    note.textContent =
        `Highest recorded occupancy: ${highest.day} (${Math.round(highest.percent)}%). ` +
        `Lowest recorded occupancy: ${lowest.day} (${Math.round(lowest.percent)}%). ` +
        "Missing bars indicate that no record was found for that weekday.";
}

function renderTable(records) {
    const tbody = document.getElementById("records-table");
    tbody.replaceChildren();

    if (!records.length) {
        const row = tbody.insertRow();
        const cell = row.insertCell();
        cell.colSpan = 6;
        cell.textContent = "No records match your selection.";
        return;
    }

    records.forEach(record => {
        const row = tbody.insertRow();

        [
            record.day,
            `Floor ${record.floor}`,
            record.name,
            record.occupied,
            record.total - record.occupied,
            `${Math.round(occupancy(record))}%`
        ].forEach(value => {
            const cell = row.insertCell();
            cell.textContent = value;
        });
    });
}

function renderPage() {
    const records = getFilteredRecords();

    renderSummary(records);
    renderOccupancyChart(records);
    renderWeekdayChart();
    renderTable(records);

    statusText.textContent =
        `${records.length} area records displayed · ${allRecords.length} valid source records loaded`;
}

async function loadData() {
    const refreshButton = document.getElementById("refresh-button");
    refreshButton.disabled = true;
    statusText.textContent = "Loading Google Sheets data...";

    try {
        allRecords = await fetchRecords();
        populateAreaSelect();
        renderPage();
        statusText.textContent += " · Data loaded successfully";
    } catch (error) {
        console.error("Patterns and Trends error:", error);
        statusText.textContent = "Unable to load data. Check the published CSV and column headers.";
    } finally {
        refreshButton.disabled = false;
    }
}

weekdaySelect.addEventListener("change", renderPage);
floorSelect.addEventListener("change", renderPage);
areaSelect.addEventListener("change", renderWeekdayChart);
document.getElementById("refresh-button").addEventListener("click", loadData);

loadData();
setInterval(loadData, 60000);
