document.addEventListener('DOMContentLoaded', () => {
    // ---- TUS PLAYLISTS DE SPOTIFY ----
    // Aquí están tus playlists configuradas
    const genres = {
        "Desafio Kochi: Quevedo": "1IaFDLfOGmJx9LH77iuMDt",
        "Facil de Reconocer": "1koyIdOfW4lxtr46r7Dwa8"
    };

    // Playlists de artistas
    const artists = {
        "Duki": "37i9dQZF1DXe1ikyKZnRtc",
        "Kanye West": "37i9dQZF1DZ06evO3nMr04"
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
    let allTracks = []; // Todas las canciones de la playlist actual para autocompletado
    let currentGenre = null; // Para recordar el género actual
    let playerScore = 0; // Sistema de puntos
    let currentSection = 'genres'; // Para recordar de dónde viene: 'genres', 'artists' o 'myplaylists'
    let isLoadingPlaylists = false; // Evitar cargas múltiples
    let hideAlbumArt = false; // Controlar si se oculta la portada

    // ---- SPOTIFY WEB PLAYBACK SDK ----
    let spotifyPlayer = null;
    let spotifyDeviceId = null;
    let isSpotifyConnected = false;
    let spotifyUser = null;
    let targetDuration = null; // Duración objetivo del clip actual
    let playStartTime = null; // Momento exacto en que empezó a reproducir

    async function getAccessToken() {
        const headers = { 'Content-Type': 'application/json' };
        const localToken = localStorage.getItem('spotify_refresh_token');
        if (localToken) {
            headers['X-Spotify-Refresh-Token'] = localToken;
        }
        const resp = await fetch('/api/spotify-access-token', { method: 'GET', headers });
        if (!resp.ok) throw new Error('No se pudo obtener access token');
        const data = await resp.json();
        return data.access_token;
    }

    async function connectSpotify(forceLogout = false) {
        try {
            // Limpiar sesión SOLO si el usuario lo pidió explícitamente (cambiar de cuenta)
            if (forceLogout) {
                try { await fetch('/api/logout', { method: 'POST' }); } catch (_) {}
                localStorage.removeItem('spotify_refresh_token');
            }

            // Verificar si hay sesión; si no, redirigir a login explícitamente
            try {
                const check = await fetch('/api/spotify-access-token', { method: 'GET' });
                if (check.status === 401) {
                    window.location.href = '/api/spotify-login';
                    return;
                }
            } catch (_) { /* ignore */ }

            // Verificar SDK disponible
            if (!window.Spotify || !window.Spotify.Player) {
                alert('Cargando SDK de Spotify... intentá de nuevo en 1-2 segundos');
                return;
            }
            if (spotifyPlayer) {
                // Si ya existe el player, solo aseguremos conexión o refresquemos UI
                if (isSpotifyConnected && spotifyDeviceId) {
                    initializeMenu();
                    return;
                }
                try { await spotifyPlayer.connect(); } catch (e) { console.warn('reconnect failed', e.message); }
                return;
            }

            spotifyPlayer = new window.Spotify.Player({
                name: 'En Una Nota',
                getOAuthToken: async cb => {
                    try { const token = await getAccessToken(); cb(token); } catch (_) { /* noop */ }
                },
                volume: 0.8
            });

            spotifyPlayer.addListener('ready', ({ device_id }) => {
                spotifyDeviceId = device_id;
                isSpotifyConnected = true;
                const btn = document.getElementById('connect-spotify-button');
                if (btn) { btn.textContent = 'Spotify Conectado'; btn.disabled = true; }
                // cargar perfil
                fetchSpotifyProfile().catch(() => {});
                // refrescar menú para habilitar modos
                initializeMenu();
            });
            spotifyPlayer.addListener('not_ready', () => {
                isSpotifyConnected = false;
            });
            spotifyPlayer.addListener('initialization_error', ({ message }) => { console.error('init_error', message); alert('Error inicializando Spotify. Recargá la página.'); });
            spotifyPlayer.addListener('authentication_error', ({ message }) => { console.error('auth_error', message); alert('Sesión expirada. Volvé a Conectar con Spotify.'); isSpotifyConnected = false; initializeMenu(); });
            spotifyPlayer.addListener('account_error', ({ message }) => { console.error('account_error', message); alert('Tu cuenta no permite streaming (requiere Premium).'); });
            
            // Listener para timing exacto: detecta cuándo REALMENTE empieza a reproducir
            spotifyPlayer.addListener('player_state_changed', state => {
                if (!state) return;
                
                // Si empieza a reproducir y tenemos una duración objetivo pendiente
                if (!state.paused && targetDuration !== null && playStartTime === null) {
                    playStartTime = Date.now();
                    
                    // Iniciar el timer AHORA que sabemos que está reproduciendo
                    clearTimeout(playTimeout);
                    playTimeout = setTimeout(async () => {
                        try { 
                            await spotifyApi('PUT', `/me/player/pause?device_id=${encodeURIComponent(spotifyDeviceId)}`); 
                        } catch (_) {}
                        const btn = document.getElementById('playBtn');
                        if (btn) btn.textContent = '▶';
                        targetDuration = null;
                        playStartTime = null;
                    }, targetDuration);
                }
            });

            await spotifyPlayer.connect();
        } catch (e) {
            console.error('Error conectando Spotify', e);
            alert('No se pudo conectar con Spotify. Verificá que autorizaste la app.');
        }
    }

    async function spotifyApi(method, path, body) {
        const token = await getAccessToken();
        const opts = { method, headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } };
        if (body) opts.body = JSON.stringify(body);
        const resp = await fetch(`https://api.spotify.com/v1${path}`, opts);
        if (!resp.ok) {
            const txt = await resp.text();
            throw new Error(`Spotify API ${method} ${path} -> ${resp.status}: ${txt}`);
        }
        return resp.status === 204 ? null : resp.json();
    }

    async function ensureActiveDevice() {
        if (!spotifyDeviceId) throw new Error('Spotify no conectado');
        try {
            await spotifyApi('PUT', '/me/player', { device_ids: [spotifyDeviceId], play: false });
        } catch (e) {
            // puede fallar si ya está activo; ignorar suavemente
            console.warn('transfer playback warn', e.message);
        }
    }

    async function fetchSpotifyProfile() {
        try {
            console.log('🔍 Intentando cargar perfil de Spotify...');
            const me = await spotifyApi('GET', '/me');
            console.log('✅ Perfil cargado:', me.display_name || me.id);
            spotifyUser = {
                id: me.id,
                name: me.display_name || (me.id ?? 'Usuario'),
                image: (me.images && me.images[0] && me.images[0].url) || ''
            };
            renderUserBadge();
            // refrescar menú para mostrar modos aun si el SDK no está listo
            initializeMenu();
        } catch (e) {
            console.error('❌ Error cargando perfil:', e.message);
        }
    }

    function renderUserBadge() {
        const existing = document.getElementById('user-badge');
        if (!spotifyUser) { if (existing) existing.remove(); return; }
        const html = `
            <div id="user-badge">
                ${spotifyUser.image ? `<img src="${spotifyUser.image}" alt="pfp" style="width:26px;height:26px;border-radius:50%;object-fit:cover;">` : ''}
                <span style="font-weight:700;">Hola, ${spotifyUser.name}</span>
            </div>
        `;
        if (existing) existing.outerHTML = html; else document.body.insertAdjacentHTML('afterbegin', html);
    }

    async function preloadTrack() {
        if (!isSpotifyConnected || !spotifyDeviceId || !currentTrack) return;
        
        try {
            await ensureActiveDevice();
            
            // Cargar la canción y posicionarla en 0:00
            await spotifyApi('PUT', `/me/player/play?device_id=${encodeURIComponent(spotifyDeviceId)}`, { 
                uris: [currentTrack.uri], 
                position_ms: 0 
            });
            
            // Pausar inmediatamente para que quede lista en 0:00
            await new Promise(resolve => setTimeout(resolve, 100)); // Pequeña espera para que cargue
            await spotifyApi('PUT', `/me/player/pause?device_id=${encodeURIComponent(spotifyDeviceId)}`);
            
            console.log('✅ Canción pre-cargada en 0:00');
        } catch (e) {
            console.warn('Pre-carga falló, se usará método normal:', e.message);
        }
    }

    async function playSpotifyClip(uri, ms) {
        clearTimeout(playTimeout);
        await ensureActiveDevice();
        
        // Configurar la duración objetivo y resetear el start time
        targetDuration = ms;
        playStartTime = null;
        
        // Verificar que la canción correcta esté cargada y en posición 0
        try {
            const state = await spotifyPlayer.getCurrentState();
            const currentUri = state?.track_window?.current_track?.uri;
            const needsReload = !state || currentUri !== uri || state.position > 100;
            
            if (needsReload) {
                // Cargar la canción correcta desde 0:00
                await spotifyApi('PUT', `/me/player/play?device_id=${encodeURIComponent(spotifyDeviceId)}`, { 
                    uris: [uri], 
                    position_ms: 0 
                });
            } else if (state.position > 10) {
                // La canción correcta está cargada pero no en 0, hacer seek
                await spotifyApi('PUT', `/me/player/seek?position_ms=0&device_id=${encodeURIComponent(spotifyDeviceId)}`);
                await new Promise(resolve => setTimeout(resolve, 50));
                // Reanudar
                await spotifyApi('PUT', `/me/player/play?device_id=${encodeURIComponent(spotifyDeviceId)}`);
            } else {
                // Todo está bien, solo reanudar
                await spotifyApi('PUT', `/me/player/play?device_id=${encodeURIComponent(spotifyDeviceId)}`);
            }
        } catch (e) {
            console.warn('Error verificando estado, cargando canción:', e.message);
            // Fallback: cargar la canción desde 0
            await spotifyApi('PUT', `/me/player/play?device_id=${encodeURIComponent(spotifyDeviceId)}`, { 
                uris: [uri], 
                position_ms: 0 
            });
        }
        
        const playBtn = document.getElementById('playBtn');
        if (playBtn) playBtn.textContent = '❚❚';
        
        // El listener 'player_state_changed' se encargará del timing exacto
        // cuando detecte que realmente empezó a reproducir
    }

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
        const connected = (!!spotifyUser) || (isSpotifyConnected && spotifyDeviceId);
        menuContainer.innerHTML = `
            <h1>EN UNA NOTA</h1>
            <div class="modes-container">
                ${!connected ? `
                <button class="mode-button spotify-button" id="connect-spotify-button">
                    <span class="spotify-logo">
                        <svg viewBox="0 0 24 24" width="24" height="24" fill="#0a0a0a" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                        </svg>
                    </span>
                    Conectar con Spotify
                </button>
                ` : ''}
                ${connected ? `
                <button class="mode-button disabled">DESAFÍO DIARIO</button>
                <button class="mode-button" id="my-playlists-button">MIS PLAYLISTS</button>
                <button class="mode-button" id="genres-button-dynamic">GÉNEROS MUSICALES</button>
                <button class="mode-button" id="artists-button-dynamic">ARTISTAS</button>
                <button class="logout-button" id="logout-button">Cerrar sesión</button>
                ` : ''}
            </div>
        `;
        const dynBtn = document.getElementById('genres-button-dynamic');
        if (dynBtn) dynBtn.onclick = () => {
            showGenreSelection();
        };
        const artistsBtn = document.getElementById('artists-button-dynamic');
        if (artistsBtn) artistsBtn.onclick = () => {
            showArtistSelection();
        };
        const connectBtn = document.getElementById('connect-spotify-button');
        if (connectBtn) connectBtn.onclick = async () => {
            // Verificar si ya hay sesión válida antes de limpiar
            const hasSession = localStorage.getItem('spotify_refresh_token');
            if (hasSession && spotifyUser) {
                // Ya hay sesión, solo conectar SDK
                connectSpotify(false);
            } else {
                // No hay sesión, limpiar y redirigir a login
                connectSpotify(true);
            }
        };
        const myPlaylistsBtn = document.getElementById('my-playlists-button');
        if (myPlaylistsBtn) {
            myPlaylistsBtn.onclick = () => {
                showMyPlaylists();
            };
        }
        const logoutBtn = document.getElementById('logout-button');
        if (logoutBtn) logoutBtn.onclick = async () => {
            try { await fetch('/api/logout', { method: 'POST' }); } catch (_) {}
            localStorage.removeItem('spotify_refresh_token');
            // resetear SDK/estado
            try { if (spotifyPlayer) { await spotifyPlayer.disconnect(); } } catch (_) {}
            spotifyPlayer = null; spotifyDeviceId = null; isSpotifyConnected = false; spotifyUser = null; renderUserBadge();
            initializeMenu();
        };
        showScreen(menuContainer);
    }

    function showGenreSelection() {
        currentSection = 'genres';
        let genreButtonsHTML = '';
        for (const [name, id] of Object.entries(genres)) {
            genreButtonsHTML += `<button class="genre-button" data-playlist-id="${id}">${name.toUpperCase()}</button>`;
        }

        genreSelectionContainer.innerHTML = `
            <button class="back-arrow-button" id="back-to-menu-button">← Volver</button>
            <h2>ELEGÍ UN GÉNERO</h2>
            <div id="genre-buttons">${genreButtonsHTML}</div>
        `;

        document.getElementById('back-to-menu-button').onclick = () => {
            initializeMenu();
        };
        
        // Usar onclick para evitar listeners duplicados
        const genreButtons = document.getElementById('genre-buttons');
        genreButtons.onclick = handleGenreClick;
        showScreen(genreSelectionContainer);
    }

    function showArtistSelection() {
        currentSection = 'artists';
        let artistButtonsHTML = '';
        for (const [name, id] of Object.entries(artists)) {
            artistButtonsHTML += `<button class="genre-button" data-playlist-id="${id}">${name.toUpperCase()}</button>`;
        }

        genreSelectionContainer.innerHTML = `
            <button class="back-arrow-button" id="back-to-menu-button">← Volver</button>
            <h2>ELEGÍ UN ARTISTA</h2>
            <div id="genre-buttons">${artistButtonsHTML}</div>
        `;

        document.getElementById('back-to-menu-button').onclick = () => {
            initializeMenu();
        };
        
        // Usar onclick para evitar listeners duplicados
        const artistButtons = document.getElementById('genre-buttons');
        artistButtons.onclick = handleGenreClick;
        showScreen(genreSelectionContainer);
    }

    // Handler para clicks en playlists (función nombrada para poder remover)
    let playlistClickHandler = null;

    async function showMyPlaylists() {
        if (isLoadingPlaylists) return;
        isLoadingPlaylists = true;
        currentSection = 'myplaylists';
        // requiere sesión
        try {
            const playlists = await spotifyApi('GET', '/me/playlists?limit=50');
            // Mostrar todas las playlists del usuario (propias y seguidas)
            const list = playlists.items || [];
            const cards = list.map(p => {
                const cover = (p.images && p.images[1] && p.images[1].url) || (p.images && p.images[0] && p.images[0].url) || '';
                const tracksTotal = p.tracks?.total ?? '';
                return `
                    <div class="playlist-card" data-playlist-id="${p.id}">
                        ${cover ? `<img src="${cover}" alt="${p.name}">` : ''}
                        <div class="playlist-title">${p.name}</div>
                        <div class="playlist-meta">${tracksTotal} temas</div>
                        <button class="genre-button" data-playlist-id="${p.id}">JUGAR</button>
                    </div>
                `;
            }).join('');
            genreSelectionContainer.innerHTML = `
                <button class="back-arrow-button" id="back-to-menu-button">← Volver</button>
                <h2>MIS PLAYLISTS</h2>
                <div id="my-playlists-grid">${cards || '<p class="loading-text">No se encontraron playlists.</p>'}</div>
            `;
            document.getElementById('back-to-menu-button').onclick = () => {
                initializeMenu();
            };
            
            // Remover listener anterior si existe
            if (playlistClickHandler) {
                genreSelectionContainer.removeEventListener('click', playlistClickHandler);
            }
            
            // Crear nuevo handler
            playlistClickHandler = (e) => {
                const btn = e.target.closest('.genre-button');
                if (btn && btn.hasAttribute('data-playlist-id')) {
                    // Verificar que Spotify esté conectado antes de continuar
                    if (!isSpotifyConnected || !spotifyDeviceId) {
                        alert('Conectando con Spotify... Intentá de nuevo en un momento.');
                        return;
                    }
                    
                    const card = btn.closest('.playlist-card');
                    const playlistName = card?.querySelector('.playlist-title')?.textContent || 'Mi playlist';
                    const playlistId = btn.getAttribute('data-playlist-id');
                    currentGenre = { playlistId, playlistName };
                    
                    genreSelectionContainer.innerHTML = `<h2 class="loading-text">Buscando una canción en "${playlistName}"...</h2>`;

                    getAccessToken().then(userToken => {
                        return fetch('/api/get-track', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ playlistId, userToken })
                        });
                    }).then(async response => {
                        if (!response.ok) {
                            let errorData = {};
                            try { errorData = await response.json(); } catch (_) {}
                            const baseMsg = errorData?.error || 'Server function returned an error';
                            const details = errorData?.details ? (typeof errorData.details === 'string' ? errorData.details : JSON.stringify(errorData.details)) : '';
                            const composed = details ? `${baseMsg} | details: ${details}` : baseMsg;
                            throw new Error(composed);
                        }
                        return response.json();
                    }).then(data => {
                        currentTrack = data.track;
                        allTracks = data.allTracks || [];
                        startGame();
                    }).catch(error => {
                        console.error("Error fetching the track:", error);
                        alert(`Hubo un error al buscar la canción: ${error.message}`);
                        showMyPlaylists();
                    });
                }
            };
            
            // Agregar nuevo listener
            genreSelectionContainer.addEventListener('click', playlistClickHandler);
            showScreen(genreSelectionContainer);
        } catch (e) {
            console.error('Error obteniendo playlists', e);
            alert('No se pudieron cargar tus playlists. Verificá la conexión con Spotify.');
        } finally {
            isLoadingPlaylists = false;
        }
    }
    
    async function handleGenreClick(event) {
        if (event.target.classList.contains('genre-button')) {
            // Verificar que Spotify esté conectado antes de continuar
            if (!isSpotifyConnected || !spotifyDeviceId) {
                alert('Conectando con Spotify... Intentá de nuevo en un momento.');
                return;
            }
            
            const playlistId = event.target.dataset.playlistId;
            const playlistName = event.target.innerText;
            currentGenre = { playlistId, playlistName };
            
            genreSelectionContainer.innerHTML = `<h2 class="loading-text">Buscando una canción en "${playlistName}"...</h2>`;

            try {
                const userToken = await getAccessToken();
                const response = await fetch('/api/get-track', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ playlistId, userToken })
                });

                if (!response.ok) {
                    let errorData = {};
                    try { errorData = await response.json(); } catch (_) { /* ignore parse error */ }
                    const baseMsg = errorData?.error || 'Server function returned an error';
                    const details = errorData?.details ? (typeof errorData.details === 'string' ? errorData.details : JSON.stringify(errorData.details)) : '';
                    const composed = details ? `${baseMsg} | details: ${details}` : baseMsg;
                    throw new Error(composed);
                }
                
                const data = await response.json();
                currentTrack = data.track;
                allTracks = data.allTracks || [];
                startGame();

            } catch (error) {
                console.error("Error fetching the track:", error);
                alert(`Hubo un error al buscar la canción: ${error.message}`);
                // Volver a la sección correcta según de dónde venía
                if (currentSection === 'artists') {
                    showArtistSelection();
                } else {
                    showGenreSelection();
                }
            }
        }
    }

    // ---- GAME LOGIC ----
    async function startGame() {
        currentAttempt = 0;
        
        gameContainer.innerHTML = `
            <div class="score-container">
                <p id="playerScore">Puntos: ${playerScore}</p>
            </div>
            <button class="back-arrow-button" id="back-from-game-button">← Volver</button>
            <div class="album-art-container">
                <img id="albumArt" src="${currentTrack.album_art}" alt="Tapa del álbum borrosa" style="${hideAlbumArt ? 'display: none;' : ''}">
            </div>
            <div class="hide-cover-toggle">
                <label class="toggle-label">
                    <input type="checkbox" id="hideCoverCheckbox" ${hideAlbumArt ? 'checked' : ''}>
                    <span class="toggle-text">🙈 Ocultar portada (modo difícil)</span>
                </label>
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
            <p id="feedback"></p>
            <div class="action-buttons">
                <button id="skipBtn" class="skip-button">Dame más tiempo</button>
                <button class="back-button" id="give-up-button">Me Rindo</button>
                <button class="back-button" id="next-song-button" style="display: none;">Siguiente Canción</button>
            </div>
        `;

        setupGameListeners();
        updateBlur();
        showScreen(gameContainer);
        
        // Pre-cargar la canción en pausa desde 0:00 para reproducción instantánea
        await preloadTrack();
    }

    function setupGameListeners() {
        const playBtn = document.getElementById('playBtn');
        const skipBtn = document.getElementById('skipBtn');
        const volumeSlider = document.getElementById('volumeSlider');
        const guessInput = document.getElementById('guessInput');
        const giveUpButton = document.getElementById('give-up-button');
        const nextSongButton = document.getElementById('next-song-button');
        const backFromGameButton = document.getElementById('back-from-game-button');
        const hideCoverCheckbox = document.getElementById('hideCoverCheckbox');
        
        if (backFromGameButton) {
            backFromGameButton.addEventListener('click', () => {
                if (currentSection === 'myplaylists') {
                    showMyPlaylists();
                } else if (currentSection === 'artists') {
                    showArtistSelection();
                } else {
                    showGenreSelection();
                }
            });
        }
        
        // Toggle para ocultar/mostrar portada
        if (hideCoverCheckbox) {
            hideCoverCheckbox.addEventListener('change', (e) => {
                hideAlbumArt = e.target.checked;
                const albumArt = document.getElementById('albumArt');
                if (albumArt) {
                    albumArt.style.display = hideAlbumArt ? 'none' : 'block';
                }
            });
        }
        
        playBtn.addEventListener('click', async () => {
            if (!isSpotifyConnected || !spotifyDeviceId) {
                alert('Primero conectá Spotify (botón en el menú).');
                return;
            }
            const duration = trackDurations[currentAttempt] || trackDurations[trackDurations.length - 1];
            try { await playSpotifyClip(currentTrack.uri, duration); } catch (e) { console.error(e); }
        });
        skipBtn.addEventListener('click', () => {
            handleSkip();
        });
        volumeSlider.addEventListener('input', (e) => { if (spotifyPlayer && spotifyPlayer.setVolume) spotifyPlayer.setVolume(e.target.value / 100); });
        
        // Autocompletado inteligente
        guessInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            if (query.length >= 1) {
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
                    // Usar el nombre original de la canción del data-attribute
                    checkGuess(highlighted.dataset.original || highlighted.textContent);
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
            giveUp();
        });
        nextSongButton.addEventListener('click', () => {
            nextSong();
        });
    }

    // Reproducción ahora gestionada por Spotify Web Playback SDK

    async function handleSkip() {
        // Funciona como un intento fallido
        const feedback = document.getElementById('feedback');
        feedback.textContent = 'Dando más tiempo...';
        feedback.className = 'incorrect';
        
        // Pausar si está reproduciendo
        try {
            await spotifyApi('PUT', `/me/player/pause?device_id=${encodeURIComponent(spotifyDeviceId)}`);
            const playBtn = document.getElementById('playBtn');
            if (playBtn) playBtn.textContent = '▶';
        } catch (e) {
            console.warn('Error pausando:', e.message);
        }
        
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
            
            // Volver a posicionar en 0:00 y pausar para el próximo intento
            await preloadTrack();
        }
    }

    async function checkGuess(guess) {
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
            
            // Pausar si está reproduciendo
            try {
                await spotifyApi('PUT', `/me/player/pause?device_id=${encodeURIComponent(spotifyDeviceId)}`);
                const playBtn = document.getElementById('playBtn');
                if (playBtn) playBtn.textContent = '▶';
            } catch (e) {
                console.warn('Error pausando:', e.message);
            }
            
            currentAttempt++;
            if (currentAttempt >= trackDurations.length) {
                endGame(false);
            } else {
                updateBlur();
                const nextDuration = (trackDurations[currentAttempt] / 1000).toFixed(1);
                document.getElementById('trackTimer').textContent = `${nextDuration}s`;
                
                // Volver a posicionar en 0:00 y pausar para el próximo intento
                await preloadTrack();
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
        
        // Revelar la portada y quitar el blur
        const albumArt = document.getElementById('albumArt');
        albumArt.style.filter = 'none';
        albumArt.style.display = 'block'; // Siempre mostrar al finalizar
        document.getElementById('guessInput').disabled = true;
        
        // Deshabilitar el checkbox para que no se pueda cambiar después de terminar
        const hideCoverCheckbox = document.getElementById('hideCoverCheckbox');
        if (hideCoverCheckbox) hideCoverCheckbox.disabled = true;
        
        if (currentSection === 'myplaylists') {
            giveUpButton.textContent = 'Elegir Otra Playlist';
            giveUpButton.onclick = showMyPlaylists;
        } else if (currentSection === 'artists') {
            giveUpButton.textContent = 'Elegir Otro Artista';
            giveUpButton.onclick = showArtistSelection;
        } else {
            giveUpButton.textContent = 'Elegir Otro Género';
            giveUpButton.onclick = showGenreSelection;
        }
        
        nextSongButton.style.display = 'inline-block';
    }

    function giveUp() {
        endGame(false);
    }

    function showSuggestions(query) {
        const suggestions = document.getElementById('suggestions');
        
        if (!allTracks || allTracks.length === 0) {
            hideSuggestions();
            return;
        }
        
        // Buscar en todas las canciones de la playlist
        const matches = [];
        
        allTracks.forEach(track => {
            const songName = track.name.toLowerCase();
            const artistName = track.artist.toLowerCase();
            const queryLower = query.toLowerCase();
            
            let score = 0;
            let matchText = '';
            
            // Scoring por relevancia (menor score = más relevante)
            if (songName.startsWith(queryLower)) {
                // Match exacto al inicio del nombre - MUY relevante
                score = 1;
                matchText = `${track.name} - ${track.artist}`;
            } else if (songName.includes(' ' + queryLower)) {
                // Match al inicio de una palabra en el nombre
                score = 2;
                matchText = `${track.name} - ${track.artist}`;
            } else if (songName.includes(queryLower)) {
                // Match en medio del nombre
                score = 3;
                matchText = `${track.name} - ${track.artist}`;
            } else if (artistName.startsWith(queryLower)) {
                // Match al inicio del artista
                score = 4;
                matchText = `${track.name} - ${track.artist}`;
            } else if (artistName.includes(' ' + queryLower)) {
                // Match al inicio de palabra del artista
                score = 5;
                matchText = `${track.name} - ${track.artist}`;
            } else if (artistName.includes(queryLower)) {
                // Match en medio del artista
                score = 6;
                matchText = `${track.name} - ${track.artist}`;
            }
            
            if (score > 0) {
                matches.push({
                    text: matchText,
                    originalName: track.name,
                    score: score
                });
            }
        });
        
        // Ordenar por score (menor primero) y tomar los mejores 8
        matches.sort((a, b) => {
            if (a.score !== b.score) return a.score - b.score;
            // Si tienen el mismo score, ordenar alfabéticamente
            return a.text.localeCompare(b.text);
        });
        
        const topMatches = matches.slice(0, 8);
        
        if (topMatches.length > 0) {
            suggestions.innerHTML = topMatches.map((match, index) => 
                `<div class="suggestion-item ${index === 0 ? 'highlighted' : ''}" data-original="${match.originalName}">${match.text}</div>`
            ).join('');
            
            // Agregar listeners a las sugerencias
            suggestions.querySelectorAll('.suggestion-item').forEach(item => {
                item.addEventListener('click', () => {
                    // Usar el nombre original de la canción para checkGuess
                    checkGuess(item.dataset.original);
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
            const userToken = await getAccessToken();
            const response = await fetch('/api/get-track', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playlistId: currentGenre.playlistId, userToken })
            });

            if (!response.ok) {
                throw new Error('Error al obtener nueva canción');
            }
            
            const data = await response.json();
            currentTrack = data.track;
            allTracks = data.allTracks || [];
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
    // Capturar token de URL si viene del callback (fallback si cookie falla)
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('token');
    if (tokenFromUrl) {
        console.log('✅ Token recibido del callback, guardando en localStorage');
        localStorage.setItem('spotify_refresh_token', tokenFromUrl);
        // Limpiar URL sin recargar
        window.history.replaceState({}, document.title, window.location.pathname);
    }
    
    initializeMenu();
    // Precargar perfil si ya hay cookie o localStorage; NO autoabrir login
    setTimeout(async () => {
        const hasToken = localStorage.getItem('spotify_refresh_token');
        if (hasToken || tokenFromUrl) {
            try { 
                await fetchSpotifyProfile(); 
                // Si el perfil se cargó, inicializar SDK automáticamente
                if (spotifyUser && !spotifyPlayer) {
                    await connectSpotify(false);
                }
            } catch (err) {
                console.warn('Error cargando perfil:', err.message);
            }
        }
    }, 800);
    if (genresButton) genresButton.addEventListener('click', () => {
        showGenreSelection();
    });
});






