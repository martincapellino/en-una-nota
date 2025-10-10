document.addEventListener('DOMContentLoaded', () => {
    // ---- TU CONFIGURACIÓN DE PLAYLISTS ----
    const genres = {
    "Today's Top Hits": "37i9dQZF1DXcBWIGoYBM5M"
    // Add more public playlist IDs here if you want
};

    // ---- REFERENCIAS A ELEMENTOS DEL DOM ----
    const menuContainer = document.getElementById('menu-container');
    const genreSelectionContainer = document.getElementById('genre-selection-container');
    const gameContainer = document.getElementById('game-container');
    
    const genresButton = document.getElementById('genres-button');
    const genreButtonsContainer = document.getElementById('genre-buttons');
    const backToMenuButton = document.getElementById('back-to-menu-button');

    // ---- ESTADO DEL JUEGO ----
    let currentTrack = null;
    let currentAttempt = 0;
    const trackDurations = [500, 2000, 5000]; // 0.5s, 2s, 5s
    const blurLevels = [20, 10, 5, 0];
    let playTimeout = null;
    let score = 0;

    // ---- FUNCIONES DE NAVEGACIÓN ----
    const showScreen = (screen) => {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        screen.classList.add('active');
    };

    // ---- LÓGICA DE MENÚS ----
    genresButton.addEventListener('click', () => {
        genreButtonsContainer.innerHTML = '';
        for (const [name, id] of Object.entries(genres)) {
            const button = document.createElement('button');
            button.className = 'genre-button';
            button.innerText = name;
            button.dataset.playlistId = id;
            genreButtonsContainer.appendChild(button);
        }
        showScreen(genreSelectionContainer);
    });

    backToMenuButton.addEventListener('click', () => {
        showScreen(menuContainer);
    });

    genreButtonsContainer.addEventListener('click', async (event) => {
        if (event.target.classList.contains('genre-button')) {
            const playlistId = event.target.dataset.playlistId;
            const playlistName = event.target.innerText;
            
            genreSelectionContainer.innerHTML = `<h2>Buscando una canción en "${playlistName}"...</h2>`;

            try {
                const response = await fetch('/api/get-track', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ playlistId })
                });


                if (!response.ok) throw new Error('El mandadero no pudo obtener la canción');
                
                currentTrack = await response.json();
                startGame();
            } catch (error) {
                console.error("Error al buscar la canción:", error);
                alert("Hubo un error al buscar la canción. Por favor, intentá de nuevo.");
                showScreen(menuContainer); 
            }
        }
    });

    // ---- LÓGICA DEL JUEGO ----
    function startGame() {
        currentAttempt = 0;
        
        // Construimos la interfaz del juego dinámicamente
        gameContainer.innerHTML = `
            <h2>¿QUÉ CANCIÓN ES?</h2>
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
                <input type="text" id="guessInput" placeholder="INTRODUCIR CANCIÓN">
            </div>
            <p id="feedback"></p>
            <audio id="audioPlayer" src="${currentTrack.preview_url}"></audio>
            <button class="back-button" id="give-up-button">Me rindo</button>
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
        
        audioPlayer.volume = volumeSlider.value / 100;

        playBtn.addEventListener('click', () => togglePlayPause(audioPlayer));
        volumeSlider.addEventListener('input', (e) => audioPlayer.volume = e.target.value / 100);
        guessInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') checkGuess(e.target.value);
        });
        giveUpButton.addEventListener('click', giveUp);
    }

    function togglePlayPause(audioPlayer) {
        clearTimeout(playTimeout);
        if (audioPlayer.paused) {
            audioPlayer.currentTime = 0;
            audioPlayer.play();
            document.getElementById('playBtn').textContent = '❚❚';

            const duration = trackDurations[currentAttempt] || 5000;
            playTimeout = setTimeout(() => {
                audioPlayer.pause();
                document.getElementById('playBtn').textContent = '▶';
            }, duration);
        } else {
            audioPlayer.pause();
            document.getElementById('playBtn').textContent = '▶';
        }
    }

    function checkGuess(guess) {
        const feedback = document.getElementById('feedback');
        // Comparamos el nombre de la canción sin importar mayúsculas/minúsculas o tildes
        const normalizedGuess = guess.trim().toLowerCase();
        const normalizedAnswer = currentTrack.name.toLowerCase();

        if (normalizedGuess === normalizedAnswer) {
            feedback.textContent = `¡CORRECTO! Era "${currentTrack.name}" de ${currentTrack.artist}`;
            feedback.className = 'correct';
            document.getElementById('albumArt').style.filter = 'none';
            document.getElementById('guessInput').disabled = true;
            document.getElementById('give-up-button').textContent = 'Jugar de Nuevo';
            document.getElementById('give-up-button').onclick = () => showScreen(genreSelectionContainer);
        } else {
            feedback.textContent = 'INCORRECTO...';
            feedback.className = 'incorrect';
            currentAttempt++;
            if (currentAttempt >= trackDurations.length) {
                giveUp();
            } else {
                updateBlur();
                const nextDuration = (trackDurations[currentAttempt] / 1000).toFixed(1);
                document.getElementById('trackTimer').textContent = `${nextDuration}s`;
            }
        }
    }
    
    function giveUp() {
        const feedback = document.getElementById('feedback');
        feedback.textContent = `Era: "${currentTrack.name}" de ${currentTrack.artist}`;
        feedback.className = 'incorrect';
        document.getElementById('albumArt').style.filter = 'none';
        document.getElementById('guessInput').disabled = true;
        document.getElementById('give-up-button').textContent = 'Jugar de Nuevo';
        document.getElementById('give-up-button').onclick = () => showScreen(genreSelectionContainer); // Reutilizamos el botón para volver
    }

    function updateBlur() {
        const albumArt = document.getElementById('albumArt');
        albumArt.style.filter = `blur(${blurLevels[currentAttempt]}px)`;
    }
});


