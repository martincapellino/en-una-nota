document.addEventListener('DOMContentLoaded', () => {
    // ---- TUS PLAYLISTS DE SPOTIFY ----
    // Aquí están tus playlists configuradas
    const genres = {
        "Kochi": "7v4y32dRRPqgENTN2T5xg1",
        "En una Nota - TPL": "2kumFei7d5KRoI2fLFgu2G"
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
    let currentGenre = null; // Para recordar el género actual
    let playerScore = 0; // Sistema de puntos

    // ---- SOUND EFFECTS ----
    const playSound = (soundType) => {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        switch(soundType) {
            case 'click':
                oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
                oscillator.frequency.exponentialRampToValueAtTime(1200, audioContext.currentTime + 0.1);
                gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + 0.1);
                break;
            case 'success':
                oscillator.frequency.setValueAtTime(523, audioContext.currentTime);
                oscillator.frequency.setValueAtTime(659, audioContext.currentTime + 0.1);
                oscillator.frequency.setValueAtTime(784, audioContext.currentTime + 0.2);
                gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + 0.3);
                break;
            case 'error':
                oscillator.frequency.setValueAtTime(200, audioContext.currentTime);
                oscillator.frequency.exponentialRampToValueAtTime(100, audioContext.currentTime + 0.2);
                gainNode.gain.setValueAtTime(0.15, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + 0.2);
                break;
        }
    };

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
        if (dynBtn) dynBtn.addEventListener('click', () => {
            playSound('click');
            showGenreSelection();
        });
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

        document.getElementById('back-to-menu-button').addEventListener('click', () => {
            playSound('click');
            initializeMenu();
        });
        document.getElementById('genre-buttons').addEventListener('click', handleGenreClick);
        showScreen(genreSelectionContainer);
    }
    
    async function handleGenreClick(event) {
        if (event.target.classList.contains('genre-button')) {
            playSound('click');
            const playlistId = event.target.dataset.playlistId;
            const playlistName = event.target.innerText;
            currentGenre = { playlistId, playlistName };
            
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
            <div class="score-container">
                <p id="playerScore">Puntos: ${playerScore}</p>
            </div>
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
                <div id="suggestions" class="suggestions-container"></div>
            </div>
            <button id="skipBtn" class="skip-button">SKIP</button>
            <p id="feedback"></p>
            <audio id="audioPlayer" src="${currentTrack.preview_url}"></audio>
            <div class="game-buttons">
                <button class="back-button" id="next-song-button" style="display: none;">Siguiente Canción</button>
                <button class="back-button" id="give-up-button">Me Rindo</button>
            </div>
        `;

        setupGameListeners();
        updateBlur();
        showScreen(gameContainer);
    }

    function setupGameListeners() {
        const playBtn = document.getElementById('playBtn');
        const skipBtn = document.getElementById('skipBtn');
        const volumeSlider = document.getElementById('volumeSlider');
        const guessInput = document.getElementById('guessInput');
        const giveUpButton = document.getElementById('give-up-button');
        const nextSongButton = document.getElementById('next-song-button');
        const audioPlayer = document.getElementById('audioPlayer');
        
        if(audioPlayer) audioPlayer.volume = volumeSlider.value / 100;

        playBtn.addEventListener('click', () => {
            playSound('click');
            togglePlayPause(audioPlayer);
        });
        skipBtn.addEventListener('click', () => {
            playSound('click');
            handleSkip();
        });
        volumeSlider.addEventListener('input', (e) => { if(audioPlayer) audioPlayer.volume = e.target.value / 100 });
        
        // Autocompletado inteligente
        guessInput.addEventListener('input', (e) => {
            const query = e.target.value.trim().toLowerCase();
            if (query.length >= 2) {
                showSuggestions(query);
            } else {
                hideSuggestions();
            }
        });
        
        guessInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const suggestions = document.querySelectorAll('.suggestion-item');
                if (suggestions.length > 0 && document.querySelector('.suggestion-item.highlighted')) {
                    const highlighted = document.querySelector('.suggestion-item.highlighted');
                    checkGuess(highlighted.textContent);
                } else {
                    checkGuess(e.target.value);
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                highlightNextSuggestion();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                highlightPrevSuggestion();
            } else if (e.key === 'Escape') {
                hideSuggestions();
            }
        });
        
        giveUpButton.addEventListener('click', () => {
            playSound('click');
            giveUp();
        });
        nextSongButton.addEventListener('click', () => {
            playSound('click');
            nextSong();
        });
    }

    function togglePlayPause(audioPlayer) {
        clearTimeout(playTimeout);
        const playBtn = document.getElementById('playBtn');
        if (audioPlayer.paused) {
            // Forzar inicio desde 0 segundos
            audioPlayer.currentTime = 0;
            // Esperar un momento para asegurar que se cargue desde 0
            setTimeout(() => {
                audioPlayer.currentTime = 0;
                audioPlayer.play().catch(e => console.error("Error playing audio:", e));
            }, 100);
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

    function handleSkip() {
        // Funciona como un intento fallido
        const feedback = document.getElementById('feedback');
        feedback.textContent = 'SKIP...';
        feedback.className = 'incorrect';
        
        currentAttempt++;
        if (currentAttempt >= trackDurations.length) {
            endGame(false);
        } else {
            updateBlur();
            const nextDuration = (trackDurations[currentAttempt] / 1000).toFixed(1);
            document.getElementById('trackTimer').textContent = `${nextDuration}s`;
            
            // Limpiar input y sugerencias
            document.getElementById('guessInput').value = '';
            hideSuggestions();
        }
    }

    function checkGuess(guess) {
        const feedback = document.getElementById('feedback');
        const normalizedGuess = guess.trim().toLowerCase();
        const normalizedAnswer = currentTrack.name.toLowerCase();

        // Verificar coincidencia exacta o parcial significativa
        const isExactMatch = normalizedGuess === normalizedAnswer;
        const isPartialMatch = normalizedAnswer.includes(normalizedGuess) && normalizedGuess.length >= 3;
        const isReverseMatch = normalizedGuess.includes(normalizedAnswer.split(' ')[0]) && normalizedAnswer.split(' ')[0].length >= 3;

        if (isExactMatch || isPartialMatch || isReverseMatch) {
            // Calcular puntos basado en el intento (menos intentos = más puntos)
            const pointsEarned = (trackDurations.length - currentAttempt) * 10;
            playerScore += pointsEarned;
            playSound('success');
            endGame(true, pointsEarned);
        } else {
            feedback.textContent = 'INCORRECTO...';
            feedback.className = 'incorrect';
            playSound('error');
            currentAttempt++;
            if (currentAttempt >= trackDurations.length) {
                endGame(false);
            } else {
                updateBlur();
                const nextDuration = (trackDurations[currentAttempt] / 1000).toFixed(1);
                document.getElementById('trackTimer').textContent = `${nextDuration}s`;
            }
        }
        hideSuggestions();
    }
    
    function endGame(isCorrect, pointsEarned = 0) {
        const feedback = document.getElementById('feedback');
        const giveUpButton = document.getElementById('give-up-button');
        const nextSongButton = document.getElementById('next-song-button');
        const audioPlayer = document.getElementById('audioPlayer');
        if(audioPlayer) audioPlayer.pause();
        clearTimeout(playTimeout);

        if (isCorrect) {
            feedback.innerHTML = `¡CORRECTO!<br>"${currentTrack.name}" de ${currentTrack.artist}<br>+${pointsEarned} puntos`;
            feedback.className = 'correct';
        } else {
            feedback.innerHTML = `Era:<br>"${currentTrack.name}" de ${currentTrack.artist}`;
            feedback.className = 'incorrect';
        }
        
        // Actualizar puntuación en pantalla
        document.getElementById('playerScore').textContent = `Puntos: ${playerScore}`;
        
        document.getElementById('albumArt').style.filter = 'none';
        document.getElementById('guessInput').disabled = true;
        giveUpButton.textContent = 'Elegir Otro Género';
        giveUpButton.onclick = showGenreSelection;
        nextSongButton.style.display = 'inline-block';
    }

    function giveUp() {
        endGame(false);
    }

    function showSuggestions(query) {
        const suggestions = document.getElementById('suggestions');
        const trackName = currentTrack.name.toLowerCase();
        
        // Buscar coincidencias parciales
        const matches = [];
        const words = trackName.split(' ');
        
        for (let i = 0; i < words.length; i++) {
            for (let j = i + 1; j <= words.length; j++) {
                const substring = words.slice(i, j).join(' ');
                if (substring.includes(query) && substring.length >= query.length) {
                    matches.push({
                        text: substring,
                        score: substring.length - query.length // Menor score = mejor match
                    });
                }
            }
        }
        
        // Ordenar por score y tomar los mejores 5
        matches.sort((a, b) => a.score - b.score);
        const topMatches = matches.slice(0, 5).map(m => m.text);
        
        if (topMatches.length > 0) {
            suggestions.innerHTML = topMatches.map((match, index) => 
                `<div class="suggestion-item ${index === 0 ? 'highlighted' : ''}" data-text="${match}">${match}</div>`
            ).join('');
            
            // Agregar listeners a las sugerencias
            suggestions.querySelectorAll('.suggestion-item').forEach(item => {
                item.addEventListener('click', () => {
                    checkGuess(item.textContent);
                });
            });
        } else {
            hideSuggestions();
        }
    }

    function hideSuggestions() {
        const suggestions = document.getElementById('suggestions');
        suggestions.innerHTML = '';
    }

    function highlightNextSuggestion() {
        const suggestions = document.querySelectorAll('.suggestion-item');
        const current = document.querySelector('.suggestion-item.highlighted');
        if (current) {
            current.classList.remove('highlighted');
            const next = current.nextElementSibling;
            if (next) {
                next.classList.add('highlighted');
            } else if (suggestions.length > 0) {
                suggestions[0].classList.add('highlighted');
            }
        }
    }

    function highlightPrevSuggestion() {
        const suggestions = document.querySelectorAll('.suggestion-item');
        const current = document.querySelector('.suggestion-item.highlighted');
        if (current) {
            current.classList.remove('highlighted');
            const prev = current.previousElementSibling;
            if (prev) {
                prev.classList.add('highlighted');
            } else if (suggestions.length > 0) {
                suggestions[suggestions.length - 1].classList.add('highlighted');
            }
        }
    }

    async function nextSong() {
        if (!currentGenre) return;
        
        const nextSongButton = document.getElementById('next-song-button');
        nextSongButton.textContent = 'Cargando...';
        nextSongButton.disabled = true;
        
        try {
            const response = await fetch('/api/get-track', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playlistId: currentGenre.playlistId })
            });

            if (!response.ok) {
                throw new Error('Error al obtener nueva canción');
            }
            
            currentTrack = await response.json();
            startGame(); // Reinicia el juego con la nueva canción

        } catch (error) {
            console.error("Error fetching next track:", error);
            alert(`Hubo un error al buscar la siguiente canción: ${error.message}`);
            nextSongButton.textContent = 'Siguiente Canción';
            nextSongButton.disabled = false;
        }
    }

    function updateBlur() {
        const albumArt = document.getElementById('albumArt');
        albumArt.style.filter = `blur(${blurLevels[currentAttempt]}px)`;
    }
    
    // ---- INITIALIZATION ----
    initializeMenu();
    if (genresButton) genresButton.addEventListener('click', () => {
        playSound('click');
        showGenreSelection();
    });
});






