// --- Core Math Engine ---
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

// --- Odds Conversion ---
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

async function fetchPlayerStats(playerId, isPitcher) {
    const statGroup = isPitcher ? "pitching" : "hitting";
    const cacheKey = `${playerId}_${statGroup}`;
    
    if (statsCache[cacheKey]) return statsCache[cacheKey];
    
    const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=season&group=${statGroup}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.stats && data.stats[0] && data.stats[0].splits[0]) {
            const stats = data.stats[0].splits[0].stat;
            stats.team = data.stats[0].splits[0].team; 
            statsCache[cacheKey] = stats;
            return stats;
        }
        return null;
    } catch { return null; }
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

function filterResults(marketName) {
    currentFilter = marketName;
    
    const buttons = document.querySelectorAll('#filters button');
    buttons.forEach(btn => {
        btn.classList.remove('bg-cyan-600', 'hover:bg-cyan-500');
        btn.classList.add('bg-gray-700', 'hover:bg-gray-600');
    });
    
    const activeBtn = document.getElementById(`btn-${marketName}`);
    if (activeBtn) {
        activeBtn.classList.remove('bg-gray-700', 'hover:bg-gray-600');
        activeBtn.classList.add('bg-cyan-600', 'hover:bg-cyan-500');
    }
    
    renderCards();
}

function renderCards() {
    const grid = document.getElementById("results-grid");
    grid.innerHTML = "";
    
    const playsToShow = currentFilter === 'all' 
        ? globalPlays 
        : globalPlays.filter(play => play.marketName === currentFilter);
        
    for (const play of playsToShow) {
        appendResultCard(play.playerName, play.marketName, play.targetLine, play.evResult, play.bookOdds, play.fairProb, play.gameTime, play.matchupData);
    }
}

function appendResultCard(player, market, line, evResult, bookOdds, fairProb, gameTime, matchupData) {
    const grid = document.getElementById("results-grid");
    const edgePercent = (evResult.edge * 100).toFixed(2);
    const hitRatePercent = (evResult.hitRate * 100).toFixed(2);
    const fairOddsStr = getAmericanOdds(fairProb);
    
    // 1/4 Kelly Calculation with Max Unit Cap
    const b = bookOdds > 0 ? (bookOdds / 100) : (100 / Math.abs(bookOdds));
    const p = evResult.hitRate;
    const q = 1 - p;
    const fullKelly = ((b * p) - q) / b;
    const quarterKellyPct = fullKelly > 0 ? (fullKelly * 0.25) : 0;
    
    let unitSize = quarterKellyPct * 100;
    
    // Strict Bankroll Management: Cap at 2.00 Units
    if (unitSize > 2.00) {
        unitSize = 2.00;
    }
    
    const kellyText = fullKelly > 0 ? `${unitSize.toFixed(2)}u` : "0.00u";

    const matchupHtml = matchupData 
        ? `<div class="text-xs text-purple-400 font-mono mb-2 mt-[-4px]">vs. ${matchupData.pitcherName} (Adj: x${matchupData.multiplier.toFixed(2)})</div>`
        : `<div class="mb-2"></div>`;

    const card = document.createElement("div");
    card.className = "bg-gray-800 p-4 rounded-lg border-l-4 border-green-500 shadow-md transition hover:bg-gray-700";
    card.innerHTML = `
        <div class="flex justify-between items-center mb-1">
            <div class="text-xs text-gray-400 uppercase">${market.replace(/_/g, ' ')}</div>
            <div class="text-xs font-bold text-cyan-400">${gameTime} CT</div>
        </div>
        <div class="text-xl font-bold text-white">${player}</div>
        ${matchupHtml}
        <div class="flex justify-between text-sm mb-1 mt-2">
            <span class="text-gray-300">Target Line:</span>
            <span class="font-bold text-white">Over ${line}</span>
        </div>
        <div class="flex justify-between text-sm mb-1">
            <span class="text-gray-300">Fair Odds:</span>
            <span class="font-bold text-blue-400">${fairOddsStr}</span>
        </div>
        <div class="flex justify-between text-sm mb-1">
            <span class="text-gray-300">Adj. Hit Rate:</span>
            <span class="font-bold text-white">${hitRatePercent}%</span>
        </div>
        <div class="mt-3 pt-3 border-t border-gray-700 flex justify-between items-center">
            <span class="text-sm text-gray-400">Monte Carlo Edge:</span>
            <span class="font-bold text-green-400 bg-green-900/30 px-2 py-1 rounded text-lg">+${edgePercent}%</span>
        </div>
        <div class="mt-2 flex justify-between items-center">
            <span class="text-sm text-gray-400">Unit Size Recommendation:</span>
            <span class="font-bold text-yellow-400">${kellyText}</span>
        </div>
    `;
    grid.appendChild(card);
}

// --- Main Orchestrator ---
async function scanSlate() {
    const apiKey = localStorage.getItem("OddsApiKey");
    document.getElementById("results-grid").innerHTML = ""; 
    globalPlays = []; 
    
    updateStatus("Fetching MLB Schedule & Probable Pitchers...");
    
    const todayDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); 
    const scheduleUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${todayDate}&hydrate=probablePitcher,team`;
    let teamStarters = {};
    
    try {
        const schedRes = await fetch(scheduleUrl);
        const scheduleData = await schedRes.json();
        if (scheduleData.dates && scheduleData.dates.length > 0) {
            for (let g of scheduleData.dates[0].games) {
                if (g.teams.home.probablePitcher) {
                    teamStarters[g.teams.home.team.name] = { id: g.teams.home.probablePitcher.id, name: g.teams.home.probablePitcher.fullName };
                }
                if (g.teams.away.probablePitcher) {
                    teamStarters[g.teams.away.team.name] = { id: g.teams.away.probablePitcher.id, name: g.teams.away.probablePitcher.fullName };
                }
            }
        }
    } catch (error) {
        console.error("Warning: Could not fetch probable pitchers.", error);
    }
    
    const marketsToScan = "pitcher_strikeouts,pitcher_outs,batter_total_bases,batter_hits_runs_rbis";
    
    try {
        const eventsResponse = await fetch(`https://api.the-odds-api.com/v4/sports/baseball_mlb/events?apiKey=${apiKey}`);
        const events = await eventsResponse.json();
        
        for (const game of events) {
            updateStatus(`Analyzing: ${game.away_team} @ ${game.home_team}...`);
            
            const gameDate = new Date(game.commence_time);
            const timeString = gameDate.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', hour12: true });
            
            // Added &oddsFormat=american parameter to ensure Kelly math works correctly
            const oddsUrl = `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${game.id}/odds?apiKey=${apiKey}&regions=us,eu&markets=${marketsToScan}&bookmakers=pinnacle&oddsFormat=american`;
            let oddsResponse = await fetch(oddsUrl);
            let oddsData = await oddsResponse.json();
            
            if (!oddsData.bookmakers || oddsData.bookmakers.length === 0) continue;
            
            for (const market of oddsData.bookmakers[0].markets) {
                const marketName = market.key;
                
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
                    let matchupData = null;
                    
                    if (isPitcher) {
                        if (marketName === "pitcher_strikeouts" && stats.gamesStarted > 0) {
                            expectedValue = stats.strikeouts / stats.gamesStarted;
                        } else if (marketName === "pitcher_outs" && stats.gamesStarted > 0) {
                            let ipParts = stats.inningsPitched.split('.');
                            let totalOuts = (parseInt(ipParts[0]) * 3) + (ipParts.length > 1 ? parseInt(ipParts[1]) : 0);
                            expectedValue = totalOuts / stats.gamesStarted;
                        }
                    } else {
                        let batterTeam = stats.team ? stats.team.name : "";
                        let opposingTeam = "";
                        
                        if (batterTeam === game.home_team) opposingTeam = game.away_team;
                        else if (batterTeam === game.away_team) opposingTeam = game.home_team;
                        else {
                            if (game.home_team.includes(batterTeam) || batterTeam.includes(game.home_team)) opposingTeam = game.away_team;
                            else if (game.away_team.includes(batterTeam) || batterTeam.includes(game.away_team)) opposingTeam = game.home_team;
                        }
                        
                        let opposingPitcher = teamStarters[opposingTeam];
                        if (!opposingPitcher) {
                            let altMatch = Object.keys(teamStarters).find(t => t.includes(opposingTeam) || opposingTeam.includes(t));
                            if (altMatch) opposingPitcher = teamStarters[altMatch];
                        }
                        
                        if (!opposingPitcher) continue;
                        
                        const pitcherStats = await fetchPlayerStats(opposingPitcher.id, true);
                        let multiplier = 1.0;
                        
                        if (pitcherStats) {
                            if (marketName === 'batter_total_bases') {
                                const pitcherSlg = parseFloat(pitcherStats.slg) || 0.400;
                                multiplier = pitcherSlg / 0.400;
                            } else if (marketName === 'batter_hits_runs_rbis') {
                                const pitcherWhip = parseFloat(pitcherStats.whip) || 1.25;
                                multiplier = pitcherWhip / 1.25;
                            }
                        }
                        
                        multiplier = Math.max(0.70, Math.min(multiplier, 1.30));
                        
                        if (marketName === "batter_total_bases" && stats.gamesPlayed > 0) {
                            expectedValue = (stats.totalBases / stats.gamesPlayed) * multiplier;
                        } else if (marketName === "batter_hits_runs_rbis" && stats.gamesPlayed > 0) {
                            expectedValue = ((stats.hits + stats.runs + stats.rbi) / stats.gamesPlayed) * multiplier;
                        }
                        
                        if (expectedValue > 0) {
                            matchupData = { pitcherName: opposingPitcher.name, multiplier: multiplier };
                        }
                    }
                    
                    if (expectedValue > 0) {
                        const evResult = runSimulation(expectedValue, targetLine, fairProb);
                        if (evResult.isPositiveEV) {
                            globalPlays.push({
                                playerName: playerName,
                                marketName: marketName,
                                targetLine: targetLine,
                                evResult: evResult,
                                bookOdds: lines['Over'].price,
                                fairProb: fairProb,
                                gameTime: timeString,
                                matchupData: matchupData
                            });
                        }
                    }
                }
            }
        }

        globalPlays.sort((a, b) => b.evResult.edge - a.evResult.edge);
        renderCards();
        updateStatus(`Scan complete. Displaying ${globalPlays.length} +EV plays.`);
    } catch (error) {
        updateStatus("Error fetching API data. Check console.");
        console.error(error);
    }
}

initDashboard();
