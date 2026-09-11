// --- Global Configurations ---
const MIN_EV = 0.03; // 3.00% Minimum Expected Value Filter

const PARK_FACTORS = {
    "Colorado Rockies": 1.12,
    "Cincinnati Reds": 1.09,
    "Boston Red Sox": 1.07,
    "Atlanta Braves": 1.05,
    "Arizona Diamondbacks": 1.02,
    "Baltimore Orioles": 0.96,
    "San Diego Padres": 0.95,
    "Seattle Mariners": 0.93
};

function getParkFactor(homeTeamName) {
    return PARK_FACTORS[homeTeamName] || 1.00;
}

// --- Monte Carlo Simulation (Poisson for Outs) ---
function getPoissonRandom(mean) {
    let L = Math.exp(-mean);
    let k = 0;
    let p = 1;
    do {
        k++;
        p *= Math.random();
    } while (p > L);
    return k - 1;
}

function runSimulation(expectedValue, targetLine, side, sims = 10000) {
    let hits = 0;
    for (let i = 0; i < sims; i++) {
        let simVal = getPoissonRandom(expectedValue);
        if (side === 'Over' && simVal > targetLine) {
            hits++;
        } else if (side === 'Under' && simVal < targetLine) {
            hits++;
        }
    }
    return hits / sims;
}

// Multiplicative De-vigging for Sharp Benchmarks
function getFairProbabilities(oddsOver, oddsUnder) {
    let probOver = oddsOver > 0 ? 100 / (oddsOver + 100) : Math.abs(oddsOver) / (Math.abs(oddsOver) + 100);
    let probUnder = oddsUnder > 0 ? 100 / (oddsUnder + 100) : Math.abs(oddsUnder) / (Math.abs(oddsUnder) + 100);
    let vig = probOver + probUnder;
    return {
        over: probOver / vig,
        under: probUnder / vig
    };
}

function getAmericanOdds(probability) {
    if (probability > 0.5) {
        return Math.round(-(probability / (1 - probability)) * 100).toString();
    } else {
        return "+" + Math.round(((1 - probability) / probability) * 100).toString();
    }
}

// --- API Functions & Caching ---
const idCache = {};
const statsCache = {};

async function fetchMlbPlayerId(playerName) {
    if (idCache[playerName]) return idCache[playerName];
    
    const encodedName = encodeURIComponent(playerName);
    const url = `https://statsapi.mlb.com/api/v1/people/search?names=${encodedName}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        const id = data.people && data.people.length > 0 ? data.people[0].id : null;
        idCache[playerName] = id;
        return id;
    } catch { return null; }
}

async function fetchPlayerStats(playerId) {
    const cacheKey = `${playerId}_pitching`;
    if (statsCache[cacheKey]) return statsCache[cacheKey];
    
    const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=season&group=pitching`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.stats && data.stats[0] && data.stats[0].splits[0]) {
            const stats = data.stats[0].splits[0].stat;
            statsCache[cacheKey] = stats;
            return stats;
        }
        return null;
    } catch { return null; }
}

async function getPitcherHand(pitcherId) {
    const cacheKey = `hand_${pitcherId}`;
    if (statsCache[cacheKey]) return statsCache[cacheKey];
    
    try {
        const response = await fetch(`https://statsapi.mlb.com/api/v1/people/${pitcherId}`);
        const data = await response.json();
        const hand = data.people[0].pitchHand.code; 
        statsCache[cacheKey] = hand;
        return hand;
    } catch { return 'R'; } 
}

// --- UI Controls & Filters ---
let globalPlays = [];
let currentFilter = 'all';

function saveApiKey() {
    const key = document.getElementById("api-key-input").value.trim();
    if (key) {
        localStorage.setItem("OddsApiKey", key);
        initDashboard();
    }
}

function clearApiKey() {
    localStorage.removeItem("OddsApiKey");
    document.getElementById("api-key-input").value = "";
    document.getElementById("setup-panel").classList.remove("hidden");
    document.getElementById("dashboard").classList.add("hidden");
    document.getElementById("results-grid").innerHTML = "";
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

function filterResults(filterKey) {
    currentFilter = filterKey;
    
    const buttons = document.querySelectorAll('#filters button');
    buttons.forEach(btn => {
        btn.classList.remove('bg-cyan-600', 'hover:bg-cyan-500');
        btn.classList.add('bg-gray-700', 'hover:bg-gray-600');
    });
    
    const activeBtn = document.getElementById(`btn-${filterKey}`);
    if (activeBtn) {
        activeBtn.classList.remove('bg-gray-700', 'hover:bg-gray-600');
        activeBtn.classList.add('bg-cyan-600', 'hover:bg-cyan-500');
    }
    
    renderCards();
}

function renderCards() {
    const grid = document.getElementById("results-grid");
    grid.innerHTML = "";
    
    let playsToShow = [];
    if (currentFilter === 'all') {
        playsToShow = globalPlays;
    } else if (currentFilter === 'sharp_value') {
        playsToShow = globalPlays.filter(play => play.isTopDownEV);
    } else {
        playsToShow = globalPlays.filter(play => play.marketName === currentFilter);
    }
        
    for (const play of playsToShow) {
        appendResultCard(play);
    }
}

function appendResultCard(play) {
    const grid = document.getElementById("results-grid");
    const evPercent = (play.ev * 100).toFixed(2);
    const simHitPercent = (play.simHitRate * 100).toFixed(2);
    const fairOddsStr = getAmericanOdds(play.fairProb);
    const retailOddsStr = play.bestRetailOdds > 0 ? `+${play.bestRetailOdds}` : `${play.bestRetailOdds}`;
    const kellyText = play.unitSize > 0 ? `${play.unitSize.toFixed(2)}u` : "0.00u";

    const topDownBadge = play.isTopDownEV 
        ? `<span class="bg-green-900 text-green-400 text-[10px] px-2 py-1 rounded shadow border border-green-500 font-bold whitespace-nowrap ml-2">🔥 Sharp Value</span>` 
        : ``;
    const retailColor = play.isTopDownEV ? "text-green-400 font-bold" : "text-red-400";
    const sideColor = play.side === "Over" ? "text-white" : "text-yellow-300"; 

    const card = document.createElement("div");
    card.className = "bg-gray-800 p-4 rounded-lg border-l-4 border-green-500 shadow-md transition hover:bg-gray-700 flex flex-col";
    card.innerHTML = `
        <div class="flex justify-between items-center mb-1">
            <div class="text-xs text-gray-400 uppercase">PITCHER OUTS</div>
            <div class="text-xs font-bold text-cyan-400">${play.gameTime} CT</div>
        </div>
        <div class="text-xl font-bold text-white flex items-center flex-wrap">${play.playerName} ${topDownBadge}</div>
        <div class="flex justify-between text-sm mb-1 mt-2">
            <span class="text-gray-300">Target Line:</span>
            <span class="font-bold ${sideColor}">${play.side} ${play.targetLine}</span>
        </div>
        <div class="flex justify-between text-sm mb-1">
            <span class="text-gray-300">${play.benchmarkName} Fair Odds:</span>
            <span class="font-bold text-blue-400">${fairOddsStr} (${(play.fairProb * 100).toFixed(1)}%)</span>
        </div>
        <div class="flex justify-between text-sm mb-2 pb-2 border-b border-gray-700">
            <span class="text-gray-300">Best Available (<span class="text-xs text-gray-400">${play.bestRetailBook}</span>):</span>
            <span class="${retailColor}">${retailOddsStr}</span>
        </div>
        <div class="flex justify-between text-sm mb-1 pt-1">
            <span class="text-gray-300">Sim Hit Rate:</span>
            <span class="font-bold text-gray-300">${simHitPercent}%</span>
        </div>
        <div class="flex justify-between items-center mb-2">
            <span class="text-sm text-gray-400">Sharp EV:</span>
            <span class="font-bold text-green-400 bg-green-900/30 px-2 py-1 rounded text-lg">+${evPercent}%</span>
        </div>
        <div class="mt-1 flex justify-between items-center border-t border-gray-700 pt-3">
            <span class="text-sm text-gray-400">Unit Sizing (1/4 Kelly):</span>
            <span class="font-bold text-yellow-400">${kellyText}</span>
        </div>
    `;
    grid.appendChild(card);
}

// --- CSV Exporter: Sharp Value Only ---
function downloadLog() {
    const sharpPlays = globalPlays.filter(play => play.isTopDownEV);
    
    if (sharpPlays.length === 0) {
        alert("No sharp value plays available to export!");
        return;
    }

    const headers = [
        "Time", "Player", "Market", "Side", "Line", 
        "Benchmark", "Fair Odds", "Fair Prob %", 
        "Best Book", "Best Odds", "Sim Hit Rate %", "Edge %", 
        "Unit Rec", "Sharp Value", "Opposing Pitcher", "Pitcher Hand", "Park Factor"
    ];

    let csvRows = [headers.join(",")];

    sharpPlays.forEach(play => {
        const fairOddsStr = getAmericanOdds(play.fairProb);
        const retailOddsStr = play.bestRetailOdds > 0 ? `+${play.bestRetailOdds}` : `${play.bestRetailOdds}`;

        const row = [
            `"${play.gameTime} CT"`,
            `"${play.playerName}"`,
            `"pitcher_outs"`,
            play.side,
            play.targetLine,
            `"${play.benchmarkName}"`,
            fairOddsStr,
            (play.fairProb * 100).toFixed(2),
            `"${play.bestRetailBook}"`,
            retailOddsStr,
            (play.simHitRate * 100).toFixed(2),
            (play.ev * 100).toFixed(2),
            play.unitSize.toFixed(2),
            "YES",
            "N/A",
            "N/A",
            "1.00"
        ];
        csvRows.push(row.join(","));
    });

    const csvData = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const csvUrl = URL.createObjectURL(csvData);
    const link = document.createElement("a");
    link.href = csvUrl;
    link.download = `MLB_Sharp_Edges_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(csvUrl);
}

// --- Main Orchestrator ---
async function scanSlate() {
    const apiKey = localStorage.getItem("OddsApiKey");
    document.getElementById("results-grid").innerHTML = ""; 
    globalPlays = []; 
    
    updateStatus("Fetching MLB Schedule...");
    
    const targetBookmakers = "pinnacle,willhill_us,draftkings,fanatics,fanduel,novig,espnbet,betmgm";
    const marketsToScan = "pitcher_outs";
    
    try {
        const eventsResponse = await fetch(`https://api.the-odds-api.com/v4/sports/baseball_mlb/events?apiKey=${apiKey}`);
        const events = await eventsResponse.json();
        
        if (!Array.isArray(events)) {
            throw new Error(events.message || "The API returned an unexpected response format.");
        }
        
        const currentTime = new Date(); 
        
        for (const game of events) {
            const gameDate = new Date(game.commence_time);
            if (gameDate < currentTime) continue; 
            
            updateStatus(`Analyzing: ${game.away_team} @ ${game.home_team}...`);
            const timeString = gameDate.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', hour12: true });
            
            const oddsUrl = `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${game.id}/odds?apiKey=${apiKey}&markets=${marketsToScan}&bookmakers=${targetBookmakers}&oddsFormat=american`;
            let oddsResponse;
            try {
                oddsResponse = await fetch(oddsUrl);
            } catch(e) { continue; }
            
            let oddsData = await oddsResponse.json();
            if (oddsData.message) throw new Error(oddsData.message);
            if (!oddsData.bookmakers || oddsData.bookmakers.length === 0) continue;
            
            const marketDict = {};
            for (const bookmaker of oddsData.bookmakers) {
                const bookName = bookmaker.title;
                for (const market of bookmaker.markets) {
                    if (market.key !== 'pitcher_outs') continue;
                    if (!marketDict['pitcher_outs']) marketDict['pitcher_outs'] = {};
                    
                    for (const outcome of market.outcomes) {
                        const playerName = outcome.description;
                        if (!playerName) continue;
                        
                        if (!marketDict['pitcher_outs'][playerName]) {
                            marketDict['pitcher_outs'][playerName] = { pinnacle: {}, fanduel: {}, retail: {} };
                        }
                        
                        if (bookmaker.key === 'pinnacle') {
                            marketDict['pitcher_outs'][playerName].pinnacle[outcome.name] = outcome;
                        } 
                        if (bookmaker.key === 'fanduel') {
                            marketDict['pitcher_outs'][playerName].fanduel[outcome.name] = outcome;
                        }
                        
                        if (!marketDict['pitcher_outs'][playerName].retail[bookName]) {
                            marketDict['pitcher_outs'][playerName].retail[bookName] = {};
                        }
                        marketDict['pitcher_outs'][playerName].retail[bookName][outcome.name] = outcome;
                    }
                }
            }
            
            for (const [playerName, lines] of Object.entries(marketDict['pitcher_outs'] || {})) {
                const fd = lines.fanduel;
                const pinny = lines.pinnacle;
                
                let targetLine = null;
                let fairProbOver = null;
                let fairProbUnder = null;
                let benchmarkName = "";
                
                if (fd && fd['Over'] && fd['Under']) {
                    targetLine = fd['Over'].point;
                    const probs = getFairProbabilities(fd['Over'].price, fd['Under'].price);
                    fairProbOver = probs.over;
                    fairProbUnder = probs.under;
                    benchmarkName = "FanDuel";
                } else if (pinny && pinny['Over'] && pinny['Under']) {
                    targetLine = pinny['Over'].point;
                    const probs = getFairProbabilities(pinny['Over'].price, pinny['Under'].price);
                    fairProbOver = probs.over;
                    fairProbUnder = probs.under;
                    benchmarkName = "Pinnacle";
                }
                
                if (targetLine === null) continue;
                
                let bestRetailOddsOver = -Infinity;
                let bestRetailBookOver = "";
                let bestRetailOddsUnder = -Infinity;
                let bestRetailBookUnder = "";
                
                for (const [retailBookName, retailLines] of Object.entries(lines.retail)) {
                    if (retailLines['Over'] && retailLines['Over'].point === targetLine) {
                        if (retailLines['Over'].price > bestRetailOddsOver) {
                            bestRetailOddsOver = retailLines['Over'].price;
                            bestRetailBookOver = retailBookName;
                        }
                    }
                    if (retailLines['Under'] && retailLines['Under'].point === targetLine) {
                        if (retailLines['Under'].price > bestRetailOddsUnder) {
                            bestRetailOddsUnder = retailLines['Under'].price;
                            bestRetailBookUnder = retailBookName;
                        }
                    }
                }
                
                // Fetch stats for reference simulation
                const playerId = await fetchMlbPlayerId(playerName);
                let expectedValue = 0;
                if (playerId) {
                    const stats = await fetchPlayerStats(playerId);
                    if (stats && stats.gamesStarted > 0) {
                        let ipParts = stats.inningsPitched.split('.');
                        let totalOuts = (parseInt(ipParts[0]) * 3) + (ipParts.length > 1 ? parseInt(ipParts[1]) : 0);
                        expectedValue = totalOuts / stats.gamesStarted;
                    }
                }

                // --- EVALUATE OVER ---
                if (bestRetailOddsOver > -Infinity) {
                    const bOver = bestRetailOddsOver > 0 ? (bestRetailOddsOver / 100) : (100 / Math.abs(bestRetailOddsOver));
                    // Expected Value calculation: (fairProb * decimalPayout) - 1
                    const evOver = (fairProbOver * (bOver + 1)) - 1;
                    
                    if (evOver >= MIN_EV) {
                        // 1/4 Kelly strictly anchored to Sharp Benchmark Fair Probability
                        const qOver = 1 - fairProbOver;
                        const fullKellyOver = ((bOver * fairProbOver) - qOver) / bOver;
                        let uSizeOver = fullKellyOver > 0 ? (fullKellyOver * 0.25 * 100) : 0;
                        if (uSizeOver > 2.00) uSizeOver = 2.00;

                        const simHitOver = expectedValue > 0 ? runSimulation(expectedValue, targetLine, 'Over') : fairProbOver;

                        globalPlays.push({
                            playerName: playerName,
                            marketName: "pitcher_outs",
                            targetLine: targetLine,
                            side: 'Over',
                            ev: evOver,
                            simHitRate: simHitOver,
                            bestRetailOdds: bestRetailOddsOver,
                            bestRetailBook: bestRetailBookOver,
                            fairProb: fairProbOver,
                            benchmarkName: benchmarkName,
                            gameTime: timeString,
                            isTopDownEV: true,
                            unitSize: uSizeOver
                        });
                    }
                }

                // --- EVALUATE UNDER ---
                if (bestRetailOddsUnder > -Infinity) {
                    const bUnder = bestRetailOddsUnder > 0 ? (bestRetailOddsUnder / 100) : (100 / Math.abs(bestRetailOddsUnder));
                    const evUnder = (fairProbUnder * (bUnder + 1)) - 1;
                    
                    if (evUnder >= MIN_EV) {
                        // 1/4 Kelly strictly anchored to Sharp Benchmark Fair Probability
                        const qUnder = 1 - fairProbUnder;
                        const fullKellyUnder = ((bUnder * fairProbUnder) - qUnder) / bUnder;
                        let uSizeUnder = fullKellyUnder > 0 ? (fullKellyUnder * 0.25 * 100) : 0;
                        if (uSizeUnder > 2.00) uSizeUnder = 2.00;

                        const simHitUnder = expectedValue > 0 ? runSimulation(expectedValue, targetLine, 'Under') : fairProbUnder;

                        globalPlays.push({
                            playerName: playerName,
                            marketName: "pitcher_outs",
                            targetLine: targetLine,
                            side: 'Under',
                            ev: evUnder,
                            simHitRate: simHitUnder,
                            bestRetailOdds: bestRetailOddsUnder,
                            bestRetailBook: bestRetailBookUnder,
                            fairProb: fairProbUnder,
                            benchmarkName: benchmarkName,
                            gameTime: timeString,
                            isTopDownEV: true,
                            unitSize: uSizeUnder
                        });
                    }
                }
            }
        }

        globalPlays.sort((a, b) => b.ev - a.ev);
        renderCards();
        updateStatus(`Scan complete. Found ${globalPlays.length} true sharp +EV plays.`);
    } catch (error) {
        updateStatus(`Error: ${error.message}`);
        document.getElementById("results-grid").innerHTML = `
            <div class="col-span-full text-red-400 p-6 bg-red-900/20 border border-red-500 rounded text-center mt-4">
                <h3 class="text-xl font-bold mb-2">API Connection Failed</h3>
                <p class="font-mono text-sm">${error.message}</p>
                <p class="mt-4 text-gray-300 text-sm">If you just updated the code, wait 1 minute for GitHub to finish deploying.</p>
            </div>
        `;
        console.error(error);
    }
}

initDashboard();
