// --- Core Math Engine (Replaces Python numpy.random.poisson) ---
function getPoissonRandom(expectedValue) {
    let L = Math.exp(-expectedValue);
    let k = 0;
    let p = 1;
    do {
        k++;
        p *= Math.random();
    } while (p > L);
    return k - 1;
}

function runSimulation(expectedValue, targetLine, fairProb, sims = 10000) {
    let hits = 0;
    for (let i = 0; i < sims; i++) {
        if (getPoissonRandom(expectedValue) > targetLine) {
            hits++;
        }
    }
    let hitRate = hits / sims;
    let edge = hitRate - fairProb;
    return { hitRate: hitRate, edge: edge, isPositiveEV: edge > 0 };
}

function getFairProbability(oddsOver, oddsUnder) {
    let probOver = oddsOver > 0 ? 100 / (oddsOver + 100) : Math.abs(oddsOver) / (Math.abs(oddsOver) + 100);
    let probUnder = oddsUnder > 0 ? 100 / (oddsUnder + 100) : Math.abs(oddsUnder) / (Math.abs(oddsUnder) + 100);
    let vig = probOver + probUnder;
    return probOver / vig;
}

// --- API Functions ---
async function fetchMlbPlayerId(playerName) {
    const encodedName = encodeURIComponent(playerName);
    const url = `https://statsapi.mlb.com/api/v1/people/search?names=${encodedName}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        return data.people && data.people.length > 0 ? data.people[0].id : null;
    } catch { return null; }
}

async function fetchPlayerStats(playerId, isPitcher) {
    const statGroup = isPitcher ? "pitching" : "hitting";
    const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=season&group=${statGroup}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        return data.stats && data.stats[0] && data.stats[0].splits[0] ? data.stats[0].splits[0].stat : null;
    } catch { return null; }
}

// --- UI Controls ---
function saveApiKey() {
    const key = document.getElementById("api-key-input").value.trim();
    if (key) {
        localStorage.setItem("OddsApiKey", key);
        initDashboard();
    }
}

function initDashboard() {
    if (localStorage.getItem("OddsApiKey")) {
        document.getElementById("setup-panel").classList.add("hidden");
        document.getElementById("dashboard").classList.remove("hidden");
    }
}

function updateStatus(message) {
    document.getElementById("status-text").innerText = message;
}

function appendResultCard(player, market, line, evResult) {
    const grid = document.getElementById("results-grid");
    const edgePercent = (evResult.edge * 100).toFixed(2);
    const hitRatePercent = (evResult.hitRate * 100).toFixed(2);
    
    // Only display +EV plays on the dashboard
    if (evResult.isPositiveEV) {
        const card = document.createElement("div");
        card.className = "bg-gray-800 p-4 rounded-lg border-l-4 border-green-500 shadow-md";
        card.innerHTML = `
            <div class="text-xs text-gray-400 uppercase mb-1">${market.replace(/_/g, ' ')}</div>
            <div class="text-xl font-bold text-white mb-2">${player}</div>
            <div class="flex justify-between text-sm mb-1">
                <span class="text-gray-300">Target Line:</span>
                <span class="font-bold text-white">Over ${line}</span>
            </div>
            <div class="flex justify-between text-sm mb-1">
                <span class="text-gray-300">Sim Hit Rate:</span>
                <span class="font-bold text-white">${hitRatePercent}%</span>
            </div>
            <div class="mt-3 pt-3 border-t border-gray-700 flex justify-between items-center">
                <span class="text-sm text-gray-400">Monte Carlo Edge</span>
                <span class="font-bold text-green-400 bg-green-900/30 px-2 py-1 rounded text-lg">+${edgePercent}%</span>
            </div>
        `;
        grid.appendChild(card);
    }
}

// --- Main Orchestrator ---
async function scanSlate() {
    const apiKey = localStorage.getItem("OddsApiKey");
    document.getElementById("results-grid").innerHTML = ""; // Clear old results
    
    updateStatus("Fetching MLB events...");
    const marketsToScan = "pitcher_strikeouts,pitcher_outs,batter_total_bases,batter_hits_runs_rbis";
    
    try {
        const eventsResponse = await fetch(`https://api.the-odds-api.com/v4/sports/baseball_mlb/events?apiKey=${apiKey}`);
        const events = await eventsResponse.json();
        
        for (const game of events) {
            updateStatus(`Analyzing: ${game.away_team} @ ${game.home_team}...`);
            
            const oddsUrl = `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${game.id}/odds?apiKey=${apiKey}&regions=us,eu&markets=${marketsToScan}&bookmakers=pinnacle`;
            let oddsResponse = await fetch(oddsUrl);
            let oddsData = await oddsResponse.json();
            
            if (!oddsData.bookmakers || oddsData.bookmakers.length === 0) continue;
            
            for (const market of oddsData.bookmakers[0].markets) {
                const marketName = market.key;
                
                // Group by player
                const players = {};
                for (const outcome of market.outcomes) {
                    if (!players[outcome.description]) players[outcome.description] = {};
                    players[outcome.description][outcome.name] = outcome;
                }
                
                for (const [playerName, lines] of Object.entries(players)) {
                    if (!lines['Over'] || !lines['Under']) continue;
                    
                    const targetLine = lines['Over'].point;
                    const fairProb = getFairProbability(lines['Over'].price, lines['Under'].price);
                    
                    const playerId = await fetchMlbPlayerId(playerName);
                    if (!playerId) continue;
                    
                    const isPitcher = marketName.includes("pitcher");
                    const stats = await fetchPlayerStats(playerId, isPitcher);
                    if (!stats) continue;
                    
                    let expectedValue = 0;
                    if (marketName === "pitcher_strikeouts" && stats.gamesStarted > 0) {
                        expectedValue = stats.strikeouts / stats.gamesStarted;
                    } else if (marketName === "pitcher_outs" && stats.gamesStarted > 0) {
                        let ipParts = stats.inningsPitched.split('.');
                        let totalOuts = (parseInt(ipParts[0]) * 3) + (ipParts.length > 1 ? parseInt(ipParts[1]) : 0);
                        expectedValue = totalOuts / stats.gamesStarted;
                    } else if (marketName === "batter_total_bases" && stats.gamesPlayed > 0) {
                        expectedValue = stats.totalBases / stats.gamesPlayed;
                    } else if (marketName === "batter_hits_runs_rbis" && stats.gamesPlayed > 0) {
                        expectedValue = (stats.hits + stats.runs + stats.rbi) / stats.gamesPlayed;
                    }
                    
                    if (expectedValue > 0) {
                        const evResult = runSimulation(expectedValue, targetLine, fairProb);
                        appendResultCard(playerName, marketName, targetLine, evResult);
                    }
                }
            }
        }
        updateStatus("Scan complete. Displaying +EV plays.");
    } catch (error) {
        updateStatus("Error fetching API data. Check console.");
        console.error(error);
    }
}

// Initialize on page load
initDashboard();
