// --- Global Configurations ---
const MIN_EDGE = 0.03; // 3.00% Minimum Edge Filter

const PARK_FACTORS = {
    "Colorado Rockies": 1.12,
    "Cincinnati Reds": 1.09,
    "Boston Red Sox": 1.07,
    "Atlanta Braves": 1.05,
    "Arizona Diamondbacks": 1.02,
    "Baltimore Orioles": 0.96,
    "San Diego Padres": 0.95,
    "Seattle Mariners": 0.93
    // All other stadiums default to 1.00
};

function getParkFactor(homeTeamName) {
    return PARK_FACTORS[homeTeamName] || 1.00;
}

// --- Core Math Engine (Upgraded to Negative Binomial) ---
function getNegativeBinomialRandom(mean, varianceMultiplier) {
    if (varianceMultiplier <= 1.001) {
        let L = Math.exp(-mean);
        let k = 0; let p = 1;
        do { k++; p *= Math.random(); } while (p > L);
        return k - 1;
    }
    
    const p = 1 / varianceMultiplier;
    const r = (mean * p) / (1 - p);
    
    let u = Math.random();
    let cumProb = 0;
    let k = 0;
    let prob = Math.pow(p, r); 
    
    while (true) {
        cumProb += prob;
        if (u < cumProb || k > 50) return k; 
        k++;
        prob = prob * (k + r - 1) / k * (1 - p);
    }
}

function runSimulation(expectedValue, targetLine, fairProb, isBatter, sims = 10000) {
    let hits = 0;
    const varianceMultiplier = isBatter ? 1.5 : 1.0; 
    
    for (let i = 0; i < sims; i++) {
        if (getNegativeBinomialRandom(expectedValue, varianceMultiplier) > targetLine) {
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
    const cacheKey = `${playerId}_overall_${statGroup}`;
    
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

async function fetchBatterSplits(playerId, sitCode) {
    const cacheKey = `${playerId}_split_${sitCode}`;
    if (statsCache[cacheKey]) return statsCache[cacheKey];
    
    const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=statSplits&group=hitting&sitCodes=${sitCode}`;
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
        appendResultCard(
            play.playerName, play.marketName, play.targetLine, play.evResult, 
            play.bestRetailOdds, play.bestRetailBook, play.fairProb, 
            play.gameTime, play.matchupData, play.isTopDownEV, play.benchmarkName
        );
    }
}

function appendResultCard(player, market, line, evResult, bestRetailOdds, bestRetailBook, fairProb, gameTime, matchupData, isTopDownEV, benchmarkName) {
    const grid = document.getElementById("results-grid");
    const edgePercent = (evResult.edge * 100).toFixed(2);
    const hitRatePercent = (evResult.hitRate * 100).toFixed(2);
    const fairOddsStr = getAmericanOdds(fairProb);
    const retailOddsStr = bestRetailOdds > 0 ? `+${bestRetailOdds}` : `${bestRetailOdds}`;
    
    const b = bestRetailOdds > 0 ? (bestRetailOdds / 100) : (100 / Math.abs(bestRetailOdds));
    const p = evResult.hitRate;
    const q = 1 - p;
    const fullKelly = ((b * p) - q) / b;
    const quarterKellyPct = fullKelly > 0 ? (fullKelly * 0.25) : 0;
    
    let unitSize = quarterKellyPct * 100;
    if (unitSize > 2.00) unitSize = 2.00;
    
    const kellyText = fullKelly > 0 ? `${unitSize.toFixed(2)}u` : "0.00u";

    const topDownBadge = isTopDownEV 
        ? `<span class="bg-green-900 text-green-400 text-[10px] px-2 py-1 rounded shadow border border-green-500 font-bold whitespace-nowrap ml-2">🔥 Sharp Value</span>` 
        : ``;
    const retailColor = isTopDownEV ? "text-green-400 font-bold" : "text-red-400";

    const matchupHtml = matchupData 
        ? `<div class="text-xs text-purple-400 font-mono mb-2 mt-[-4px]">vs. ${matchupData.pitcherName} (${matchupData.pitcherHand}) | PF: x${matchupData.parkFactor.toFixed(2)}</div>`
        : `<div class="mb-2"></div>`;

    const card = document.createElement("div");
    card.className = "bg-gray-800 p-4 rounded-lg border-l-4 border-green-500 shadow-md transition hover:bg-gray-700 flex flex-col";
    card.innerHTML = `
        <div class="flex justify-between items-center mb-1">
            <div class="text-xs text-gray-400 uppercase">${market.replace(/_/g, ' ')}</div>
            <div class="text-xs font-bold text-cyan-400">${gameTime} CT</div>
        </div>
        <div class="text-xl font-bold text-white flex items-center flex-wrap">${player} ${topDownBadge}</div>
        ${matchupHtml}
        <div class="flex justify-between text-sm mb-1 mt-2">
            <span class="text-gray-300">Target Line:</span>
            <span class="font-bold text-white">Over ${line}</span>
        </div>
        <div class="flex justify-between text-sm mb-1">
            <span class="text-gray-300">${benchmarkName} Fair Odds:</span>
            <span class="font-bold text-blue-400">${fairOddsStr}</span>
        </div>
        <div class="flex justify-between text-sm mb-2 pb-2 border-b border-gray-700">
            <span class="text-gray-300">Best Available (<span class="text-xs text-gray-400">${bestRetailBook}</span>):</span>
            <span class="${retailColor}">${retailOddsStr}</span>
        </div>
        <div class="flex justify-between text-sm mb-1 pt-1">
            <span class="text-gray-300">Adj. Sim Hit Rate:</span>
            <span class="font-bold text-white">${hitRatePercent}%</span>
        </div>
        <div class="flex justify-between items-center mb-2">
            <span class="text-sm text-gray-400">Monte Carlo Edge:</span>
            <span class="font-bold text-green-400 bg-green-900/30 px-2 py-1 rounded text-lg">+${edgePercent}%</span>
        </div>
        <div class="mt-1 flex justify-between items-center border-t border-gray-700 pt-3">
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
                    const id = g.teams.home.probablePitcher.id;
                    teamStarters[g.teams.home.team.name] = { id: id, name: g.teams.home.probablePitcher.fullName, hand: await getPitcherHand(id) };
                }
                if (g.teams.away.probablePitcher) {
                    const id = g.teams.away.probablePitcher.id;
                    teamStarters[g.teams.away.team.name] = { id: id, name: g.teams.away.probablePitcher.fullName, hand: await getPitcherHand(id) };
                }
            }
        }
    } catch (error) {
        console.error("Warning: Could not fetch probable pitchers.", error);
    }
    
    const targetBookmakers = "pinnacle,williamhill_us,draftkings,fanatics,fanduel,novig,espnbet,betmgm";
    // REMOVED pitcher_strikeouts to save credits
    const marketsToScan = "pitcher_outs,batter_total_bases,batter_home_runs";
    
    try {
        updateStatus("Fetching Odds from API...");
        const currentTime = new Date(); 
        
        // MASSIVE OPTIMIZATION: Fetch all games in ONE request instead of querying by game.id
        const oddsUrl = `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds?apiKey=${apiKey}&markets=${marketsToScan}&bookmakers=${targetBookmakers}&oddsFormat=american`;
        
        let oddsResponse = await fetch(oddsUrl);
        let events = await oddsResponse.json();
        
        for (const game of events) {
            const gameDate = new Date(game.commence_time);
            if (gameDate < currentTime) continue; 
            
            updateStatus(`Analyzing: ${game.away_team} @ ${game.home_team}...`);
            const timeString = gameDate.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', hour12: true });
            const currentParkFactor = getParkFactor(game.home_team);
            
            // Skip the game if there are no bookmakers available yet
            if (!game.bookmakers || game.bookmakers.length === 0) continue;
            
            const marketDict = {};
            for (const bookmaker of game.bookmakers) {
                const bookName = bookmaker.title;
                
                for (const market of bookmaker.markets) {
                    const marketName = market.key;
                    if (!marketDict[marketName]) marketDict[marketName] = {};
                    
                    for (const outcome of market.outcomes) {
                        const playerName = outcome.description;
                        if (!playerName) continue;
                        
                        if (!marketDict[marketName][playerName]) {
                            marketDict[marketName][playerName] = { pinnacle: {}, fanduel: {}, retail: {} };
                        }
                        
                        if (bookmaker.key === 'pinnacle') {
                            marketDict[marketName][playerName].pinnacle[outcome.name] = outcome;
                        } 
                        if (bookmaker.key === 'fanduel') {
                            marketDict[marketName][playerName].fanduel[outcome.name] = outcome;
                        }
                        
                        if (!marketDict[marketName][playerName].retail[bookName]) {
                            marketDict[marketName][playerName].retail[bookName] = {};
                        }
                        marketDict[marketName][playerName].retail[bookName][outcome.name] = outcome;
                    }
                }
            }
            
            for (const [marketName, players] of Object.entries(marketDict)) {
                for (const [playerName, lines] of Object.entries(players)) {
                    
                    const fd = lines.fanduel;
                    const pinny = lines.pinnacle;
                    
                    let targetLine = null;
                    let fairProb = null;
                    let benchmarkName = "";
                    
                    if (fd && fd['Over'] && fd['Under']) {
                        targetLine = fd['Over'].point;
                        fairProb = getFairProbability(fd['Over'].price, fd['Under'].price);
                        benchmarkName = "FanDuel";
                    } 
                    else if (pinny && pinny['Over'] && pinny['Under']) {
                        targetLine = pinny['Over'].point;
                        fairProb = getFairProbability(pinny['Over'].price, pinny['Under'].price);
                        benchmarkName = "Pinnacle";
                    }
                    
                    if (fairProb === null || targetLine === null) continue;
                    
                    let bestRetailOdds = -Infinity;
                    let bestRetailBook = "";
                    
                    for (const [retailBookName, retailLines] of Object.entries(lines.retail)) {
                        if (retailLines['Over'] && retailLines['Over'].point === targetLine) {
                            if (retailLines['Over'].price > bestRetailOdds) {
                                bestRetailOdds = retailLines['Over'].price;
                                bestRetailBook = retailBookName;
                            }
                        }
                    }
                    
                    if (bestRetailOdds === -Infinity) continue; 
                    
                    const playerId = await fetchMlbPlayerId(playerName);
                    if (!playerId) continue;
                    
                    const isPitcher = marketName.includes("pitcher");
                    let expectedValue = 0;
                    let matchupData = null;
                    
                    if (isPitcher) {
                        const stats = await fetchPlayerStats(playerId, true);
                        if (!stats) continue;

                        if (marketName === "pitcher_outs" && stats.gamesStarted > 0) {
                            let ipParts = stats.inningsPitched.split('.');
                            let totalOuts = (parseInt(ipParts[0]) * 3) + (ipParts.length > 1 ? parseInt(ipParts[1]) : 0);
                            expectedValue = totalOuts / stats.gamesStarted;
                        }
                    } else {
                        const fallbackStats = await fetchPlayerStats(playerId, false);
                        if (!fallbackStats) continue;
                        
                        let batterTeam = fallbackStats.team ? fallbackStats.team.name : "";
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
                        
                        const pitcherHand = opposingPitcher.hand; 
                        const sitCode = pitcherHand === 'L' ? 'vl' : 'vr';
                        
                        let stats = await fetchBatterSplits(playerId, sitCode);
                        if (!stats || stats.gamesPlayed === 0) {
                            stats = fallbackStats; 
                        }
                        
                        const pitcherStats = await fetchPlayerStats(opposingPitcher.id, true);
                        let multiplier = 1.0;
                        
                        if (pitcherStats) {
                            if (marketName === 'batter_total_bases') {
                                const pitcherSlg = parseFloat(pitcherStats.slg) || 0.400;
                                multiplier = pitcherSlg / 0.400;
                            } else if (marketName === 'batter_home_runs') {
                                let ipParts = pitcherStats.inningsPitched ? pitcherStats.inningsPitched.split('.') : ['0'];
                                let totalOuts = (parseInt(ipParts[0]) * 3) + (ipParts.length > 1 ? parseInt(ipParts[1]) : 0);
                                let hrPer9 = totalOuts > 0 ? (pitcherStats.homeRuns / (totalOuts / 3)) * 9 : 1.15;
                                multiplier = hrPer9 / 1.15;
                            }
                        }
                        
                        multiplier = Math.max(0.60, Math.min(multiplier, 1.40));
                        const finalMultiplier = multiplier * currentParkFactor;

                        console.log(`TESTING ${playerName} | vs ${pitcherHand}HP | Park Factor: ${currentParkFactor.toFixed(2)} | Games in this Split: ${stats.gamesPlayed}`);
                        
                        if (marketName === "batter_total_bases" && stats.gamesPlayed > 0) {
                            expectedValue = (stats.totalBases / stats.gamesPlayed) * finalMultiplier;
                        } else if (marketName === "batter_home_runs" && stats.gamesPlayed > 0) {
                            const hrCount = stats.homeRuns || 0;
                            expectedValue = (hrCount / stats.gamesPlayed) * finalMultiplier;
                        }
                        
                        if (expectedValue > 0) {
                            matchupData = { 
                                pitcherName: opposingPitcher.name, 
                                multiplier: finalMultiplier, 
                                pitcherHand: pitcherHand,
                                parkFactor: currentParkFactor
                            };
                        }
                    }
                    
                    if (expectedValue > 0) {
                        const retailProb = bestRetailOdds > 0 ? 100 / (bestRetailOdds + 100) : Math.abs(bestRetailOdds) / (Math.abs(bestRetailOdds) + 100);
                        const isTopDownEV = retailProb < fairProb;
                        const evResult = runSimulation(expectedValue, targetLine, retailProb, !isPitcher);
                        
                        if (evResult.isPositiveEV && evResult.edge >= MIN_EDGE) {
                            globalPlays.push({
                                playerName: playerName,
                                marketName: marketName,
                                targetLine: targetLine,
                                evResult: evResult,
                                bestRetailOdds: bestRetailOdds,
                                bestRetailBook: bestRetailBook,
                                fairProb: fairProb,
                                benchmarkName: benchmarkName,
                                gameTime: timeString,
                                matchupData: matchupData,
                                isTopDownEV: isTopDownEV
                            });
                        }
                    }
                }
            }
        }

        globalPlays.sort((a, b) => b.evResult.edge - a.evResult.edge);
        renderCards();
        updateStatus(`Scan complete. Displaying ${globalPlays.length} premium +EV plays.`);
    } catch (error) {
        updateStatus("Error fetching API data. Check console.");
        console.error(error);
    }
}

initDashboard();
