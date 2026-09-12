// --- Global Configurations ---
const MIN_EV_PINNACLE = 0.03; // 3.00% Minimum EV when benchmarking against Pinnacle
const MIN_EV_FANDUEL = 0.05;  // 5.00% Minimum EV when falling back to FanDuel

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

// --- UI Controls & State ---
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
    if (currentFilter === 'all' || currentFilter === 'pitcher_outs') {
        playsToShow = globalPlays;
    } else if (currentFilter === 'sharp_value') {
        playsToShow = globalPlays.filter(play => play.isTopDownEV);
    }
        
    for (const play of playsToShow) {
        appendResultCard(play);
    }
}

function appendResultCard(play) {
    const grid = document.getElementById("results-grid");
    const evPercent = (play.ev * 100).toFixed(2);
    const fairOddsStr = getAmericanOdds(play.fairProb);
    const retailOddsStr = play.bestRetailOdds > 0 ? `+${play.bestRetailOdds}` : `${play.bestRetailOdds}`;
    const kellyText = play.unitSize > 0 ? `${play.unitSize.toFixed(2)}u` : "0.00u";

    const benchmarkBadgeColor = play.benchmarkName === "Pinnacle" ? "bg-blue-900 border-blue-500 text-blue-300" : "bg-purple-900 border-purple-500 text-purple-300";
    const sideColor = play.side === "Over" ? "text-white" : "text-yellow-300"; 

    const card = document.createElement("div");
    card.className = "bg-gray-800 p-4 rounded-lg border-l-4 border-green-500 shadow-md transition hover:bg-gray-700 flex flex-col";
    card.innerHTML = `
        <div class="flex justify-between items-center mb-1">
            <div class="text-xs text-gray-400 uppercase">PITCHER OUTS</div>
            <div class="text-xs font-bold text-cyan-400">${play.gameTime} CT</div>
        </div>
        <div class="text-xl font-bold text-white flex items-center flex-wrap gap-2">
            ${play.playerName}
            <span class="text-[10px] px-2 py-0.5 rounded border font-semibold ${benchmarkBadgeColor}">
                ${play.benchmarkName} Ref
            </span>
        </div>
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
            <span class="text-green-400 font-bold">${retailOddsStr}</span>
        </div>
        <div class="flex justify-between items-center mb-2 pt-1">
            <span class="text-sm text-gray-400">Sharp Edge (EV):</span>
            <span class="font-bold text-green-400 bg-green-900/30 px-2 py-1 rounded text-lg">+${evPercent}%</span>
        </div>
        <div class="mt-1 flex justify-between items-center border-t border-gray-700 pt-3">
            <span class="text-sm text-gray-400">Unit Sizing (1/4 Kelly):</span>
            <span class="font-bold text-yellow-400">${kellyText}</span>
        </div>
    `;
    grid.appendChild(card);
}

// --- Automated Google Sheets Sync ---
function syncToSheets() {
    // Filter for only the Sharp Value plays
    const sharpPlays = globalPlays.filter(play => play.isTopDownEV);
    
    if (sharpPlays.length === 0) {
        alert("No sharp value plays available to sync!");
        return;
    }

    updateStatus("Syncing to Google Sheets...");

    // Format the data to perfectly match your spreadsheet columns
    const payload = sharpPlays.map(play => {
        const fairOddsStr = getAmericanOdds(play.fairProb);
        const retailOddsStr = play.bestRetailOdds > 0 ? `+${play.bestRetailOdds}` : `${play.bestRetailOdds}`;

        return {
            time: `${play.gameTime} CT`,
            player: play.playerName,
            market: "pitcher_outs",
            side: play.side,
            line: play.targetLine,
            benchmark: play.benchmarkName,
            fairOdds: fairOddsStr,
            fairProb: (play.fairProb * 100).toFixed(2),
            bestBook: play.bestRetailBook,
            bestOdds: retailOddsStr,
            ev: (play.ev * 100).toFixed(2),
            unitRec: play.unitSize.toFixed(2),
            sharpValue: "YES"
        };
    });

    // The user's provided Webhook URL
    const WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbwlIS-p22XnZr-KFX57fp_sxwOhdq-8BY-pzzAdEqSwi04dUf8nlfaNhIOFoIgwvXCQ3w/exec";

    // Fire the data into the cloud spreadsheet
    fetch(WEBHOOK_URL, {
        method: 'POST',
        mode: 'no-cors', // Bypasses cross-origin restrictions
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
    }).then(() => {
        updateStatus(`Successfully synced ${sharpPlays.length} plays to your ledger!`);
    }).catch(error => {
        console.error(error);
        updateStatus("Error syncing to Sheets. Check console.");
    });
}

// --- Main Orchestrator ---
async function scanSlate() {
    const apiKey = localStorage.getItem("OddsApiKey");
    document.getElementById("results-grid").innerHTML = ""; 
    globalPlays = []; 
    
    updateStatus("Fetching MLB Events...");
    
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
            
            updateStatus(`Scanning: ${game.away_team} @ ${game.home_team}...`);
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
                const pinny = lines.pinnacle;
                const fd = lines.fanduel;
                
                let targetLine = null;
                let fairProbOver = null;
                let fairProbUnder = null;
                let benchmarkName = "";
                let requiredMinEv = MIN_EV_PINNACLE;

                // --- WATERFALL BENCHMARK LOGIC ---
                // Step 1: Check Pinnacle First (True Sharp Anchor)
                if (pinny && pinny['Over'] && pinny['Under']) {
                    targetLine = pinny['Over'].point;
                    const probs = getFairProbabilities(pinny['Over'].price, pinny['Under'].price);
                    fairProbOver = probs.over;
                    fairProbUnder = probs.under;
                    benchmarkName = "Pinnacle";
                    requiredMinEv = MIN_EV_PINNACLE; // 3%
                } 
                // Step 2: Fallback to FanDuel only if Pinnacle has no posted lines
                else if (fd && fd['Over'] && fd['Under']) {
                    targetLine = fd['Over'].point;
                    const probs = getFairProbabilities(fd['Over'].price, fd['Under'].price);
                    fairProbOver = probs.over;
                    fairProbUnder = probs.under;
                    benchmarkName = "FanDuel";
                    requiredMinEv = MIN_EV_FANDUEL; // Stricter 5% floor
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

                // --- EVALUATE OVER ---
                if (bestRetailOddsOver > -Infinity) {
                    const bOver = bestRetailOddsOver > 0 ? (bestRetailOddsOver / 100) : (100 / Math.abs(bestRetailOddsOver));
                    const evOver = (fairProbOver * (bOver + 1)) - 1;
                    
                    if (evOver >= requiredMinEv) {
                        const qOver = 1 - fairProbOver;
                        const fullKellyOver = ((bOver * fairProbOver) - qOver) / bOver;
                        let uSizeOver = fullKellyOver > 0 ? (fullKellyOver * 0.25 * 100) : 0;
                        if (uSizeOver > 2.00) uSizeOver = 2.00;

                        globalPlays.push({
                            playerName: playerName,
                            marketName: "pitcher_outs",
                            targetLine: targetLine,
                            side: 'Over',
                            ev: evOver,
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
                    
                    if (evUnder >= requiredMinEv) {
                        const qUnder = 1 - fairProbUnder;
                        const fullKellyUnder = ((bUnder * fairProbUnder) - qUnder) / bUnder;
                        let uSizeUnder = fullKellyUnder > 0 ? (fullKellyUnder * 0.25 * 100) : 0;
                        if (uSizeUnder > 2.00) uSizeUnder = 2.00;

                        globalPlays.push({
                            playerName: playerName,
                            marketName: "pitcher_outs",
                            targetLine: targetLine,
                            side: 'Under',
                            ev: evUnder,
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
        updateStatus(`Scan complete. Found ${globalPlays.length} filtered sharp plays.`);
    } catch (error) {
        updateStatus(`Error: ${error.message}`);
        document.getElementById("results-grid").innerHTML = `
            <div class="col-span-full text-red-400 p-6 bg-red-900/20 border border-red-500 rounded text-center mt-4">
                <h3 class="text-xl font-bold mb-2">API Connection Failed</h3>
                <p class="font-mono text-sm">${error.message}</p>
                <p class="mt-4 text-gray-300 text-sm">Wait 1 minute for GitHub to finish deploying.</p>
            </div>
        `;
        console.error(error);
    }
}

initDashboard();
