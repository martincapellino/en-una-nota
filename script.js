document.addEventListener('DOMContentLoaded', () => {
    // ---- YOUR PLAYLIST CONFIGURATION ----
    // This is where you add the genres and their corresponding PUBLIC Spotify Playlist IDs.
    const genres = {
        "Today's Top Hits": "37i9dQZF1DXcBWIGoYBM5M",
        "Rock Classics": "37i9dQZF1DWXRqgorJj26U",
        "Viva Latino": "37i9dQZF1DX10zKGVs6_cs"
    };

    // ---- DOM ELEMENT REFERENCES ----
    const appContainer = document.getElementById('app-container');
    const menuContainer = document.getElementById('menu-container');
    const genreSelectionContainer = document.getElementById('genre-selection-container');
    const gameContainer = document.getElementById('game-container');
    
    const genresButton = document.getElementById('genres-button');

    // ---- GAME STATE ----
    let currentTrack = null;
    let currentAttempt = 0;
    const trackDurations = [500, 2000, 5000]; // 0.5s, 2s, 5s
    const blurLevels = [25, 15, 5, 0];
    let playTimeout = null;
    let allTrackNames = []; // For the autocomplete suggestions

    // ---- NAVIGATION LOGIC ----
    const showScreen = (screen) => {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        screen.classList.add('active');
    };

    // ---- MENU & GENRE SELECTION LOGIC ----
    function initializeMenu() {
        // Build the main menu
        menuContainer.innerHTML = `
            <h1>EN UNA NOTA</h1>
            <div class="modes-container">
                <button class="mode-button disabled">DESAFÍO DIARIO</button>
                <button class="mode-button disabled">MIS PLAYLISTS</button>
                <button class="mode-button" id="genres-button-dynamic">GÉNEROS MUSICALES</button>
            </div>
        `;
        const dynBtn = document.getElementById('genres-button-dynamic');
        if (dynBtn) dynBtn.addEventListener('click', showGenreSelection);
        showScreen(menuContainer);
    }

    function showGenreSelection() {
        let genreButtonsHTML = '';
        for (const [name, id] of Object.entries(genres)) {
            genreButtonsHTML += `<button class="genre-button" data-playlist-id="${id}">${name.toUpperCase()}</button>`;
        }

        genreSelectionContainer.innerHTML = `
            <h2>ELEGÍ UN GÉNERO</h2>
            <div id="genre-buttons">${genreButtonsHTML}</div>
            <button class="back-button" id="back-to-menu-button">Volver</button>
        `;

        document.getElementById('back-to-menu-button').addEventListener('click', initializeMenu);
        document.getElementById('genre-buttons').addEventListener('click', handleGenreClick);
        showScreen(genreSelectionContainer);
    }
    
    async function handleGenreClick(event) {
        if (event.target.classList.contains('genre-button')) {
            const playlistId = event.target.dataset.playlistId;
            const playlistName = event.target.innerText;
            
            genreSelectionContainer.innerHTML = `<h2 class="loading-text">Buscando una canción en "${playlistName}"...</h2>`;

            try {
                const response = await fetch('/api/get-track', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ playlistId })
                });

                if (!response.ok) {
                    let errorData = {};
                    try { errorData = await response.json(); } catch (_) { /* ignore parse error */ }
                    const baseMsg = errorData?.error || 'Server function returned an error';
                    const details = errorData?.details ? (typeof errorData.details === 'string' ? errorData.details : JSON.stringify(errorData.details)) : '';
                    const composed = details ? `${baseMsg} | details: ${details}` : baseMsg;
                    throw new Error(composed);
                }
                
                currentTrack = await response.json();
                startGame();

            } catch (error) {
                console.error("Error fetching the track:", error);
                alert(`Hubo un error al buscar la canción: ${error.message}`);
                showGenreSelection(); 
            }
        }
    }

    // ---- GAME LOGIC ----
    function startGame() {
        currentAttempt = 0;
        
        gameContainer.innerHTML = `
            <div class="album-art-container">
                <img id="albumArt" src="${currentTrack.album_art}" alt="Tapa del álbum borrosa">
            </div>
            <div class="timer-container">
                <p id="trackTimer">${(trackDurations[0] / 1000).toFixed(1)}s</p>
            </div>
            <div class="controls-area">
                <button id="playBtn">▶</button>
                <span class="volume-icon">🔊</span>
                <input type="range" id="volumeSlider" min="0" max="100" value="80">
            </div>
            <div class="input-area">
                <input type="text" id="guessInput" placeholder="INTRODUCIR CANCIÓN" autocomplete="off">
            </div>
            <p id="feedback"></p>
            <audio id="audioPlayer" src="${currentTrack.preview_url}"></audio>
            <button class="back-button" id="give-up-button">Me Rindo</button>
        `;

        setupGameListeners();
        updateBlur();
        showScreen(gameContainer);
    }

    function setupGameListeners() {
        const playBtn = document.getElementById('playBtn');
        const volumeSlider = document.getElementById('volumeSlider');
        const guessInput = document.getElementById('guessInput');
        const giveUpButton = document.getElementById('give-up-button');
        const audioPlayer = document.getElementById('audioPlayer');
        
        if(audioPlayer) audioPlayer.volume = volumeSlider.value / 100;

        playBtn.addEventListener('click', () => togglePlayPause(audioPlayer));
        volumeSlider.addEventListener('input', (e) => { if(audioPlayer) audioPlayer.volume = e.target.value / 100 });
        guessInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') checkGuess(e.target.value);
        });
        giveUpButton.addEventListener('click', giveUp);
    }

    function togglePlayPause(audioPlayer) {
        clearTimeout(playTimeout);
        const playBtn = document.getElementById('playBtn');
        if (audioPlayer.paused) {
            audioPlayer.currentTime = 0;
            audioPlayer.play().catch(e => console.error("Error playing audio:", e));
            playBtn.textContent = '❚❚';

            const duration = trackDurations[currentAttempt] || trackDurations[trackDurations.length - 1];
            playTimeout = setTimeout(() => {
                if (audioPlayer && !audioPlayer.paused) {
                    audioPlayer.pause();
                    playBtn.textContent = '▶';
                }
            }, duration);
        } else {
            audioPlayer.pause();
            playBtn.textContent = '▶';
        }
    }

    function checkGuess(guess) {
        const feedback = document.getElementById('feedback');
        const normalizedGuess = guess.trim().toLowerCase();
        const normalizedAnswer = currentTrack.name.toLowerCase();

        if (normalizedGuess === normalizedAnswer) {
            endGame(true);
        } else {
            feedback.textContent = 'INCORRECTO...';
            feedback.className = 'incorrect';
            currentAttempt++;
            if (currentAttempt >= trackDurations.length) {
                endGame(false);
            } else {
                updateBlur();
                const nextDuration = (trackDurations[currentAttempt] / 1000).toFixed(1);
                document.getElementById('trackTimer').textContent = `${nextDuration}s`;
            }
        }
    }
    
    function endGame(isCorrect) {
        const feedback = document.getElementById('feedback');
        const giveUpButton = document.getElementById('give-up-button');
        const audioPlayer = document.getElementById('audioPlayer');
        if(audioPlayer) audioPlayer.pause();
        clearTimeout(playTimeout);

        if (isCorrect) {
            feedback.innerHTML = `¡CORRECTO!<br>"${currentTrack.name}" de ${currentTrack.artist}`;
            feedback.className = 'correct';
        } else {
            feedback.innerHTML = `Era:<br>"${currentTrack.name}" de ${currentTrack.artist}`;
            feedback.className = 'incorrect';
        }
        
        document.getElementById('albumArt').style.filter = 'none';
        document.getElementById('guessInput').disabled = true;
        giveUpButton.textContent = 'Elegir Otro Género';
        giveUpButton.onclick = showGenreSelection;
    }

    function giveUp() {
        endGame(false);
    }

    function updateBlur() {
        const albumArt = document.getElementById('albumArt');
        albumArt.style.filter = `blur(${blurLevels[currentAttempt]}px)`;
    }
    
    // ---- INITIALIZATION ----
    initializeMenu();
    if (genresButton) genresButton.addEventListener('click', showGenreSelection);
});


