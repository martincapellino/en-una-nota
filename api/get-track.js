const axios = require('axios');

// 🔑 CREDENCIALES DE SPOTIFY (usar variables de entorno)
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

function sendJsonError(res, statusCode, message, extra) {
    const payload = { error: message };
    if (extra) payload.details = extra;
    return res.status(statusCode).json(payload);
}

// Obtener token de acceso de Spotify (prefiere refresh token si existe)
async function getSpotifyToken() {
    try {
        if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
            throw new Error('Faltan variables de entorno SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET');
        }
        const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;
        let tokenResp;
        if (refreshToken) {
            tokenResp = await axios.post(
                'https://accounts.spotify.com/api/token',
                new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: refreshToken
                }).toString(),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64')
                    },
                    timeout: 10000
                }
            );
        } else {
            tokenResp = await axios.post(
                'https://accounts.spotify.com/api/token',
                'grant_type=client_credentials',
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64')
                    },
                    timeout: 10000
                }
            );
        }
        return tokenResp.data.access_token;
    } catch (error) {
        console.error('Error obteniendo token de Spotify:', error.message);
        throw new Error('No se pudo autenticar con Spotify');
    }
}

// Obtener TODAS las canciones de una playlist de Spotify (paginado)
async function fetchTracksFromSpotifyPlaylist(playlistId, token) {
    try {
        const limit = 100;
        let offset = 0;
        let allItems = [];
        let nextUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`;

        while (nextUrl) {
            const response = await axios.get(nextUrl, {
                headers: { 'Authorization': `Bearer ${token}` },
                timeout: 15000
            });

            const items = response.data.items || [];
            allItems = allItems.concat(items);
            nextUrl = response.data.next || null;
        }

        // Filtrar solo las canciones con preview y que no sean locales/episodios
        const playableTracks = allItems
            .filter(item => item && item.track && item.track.type === 'track' && !item.track.is_local && item.track.preview_url)
            .map(item => ({
                name: item.track.name,
                artist: item.track.artists.map(a => a.name).join(', '),
                preview_url: item.track.preview_url,
                album_art: (item.track.album.images && item.track.album.images[0] && item.track.album.images[0].url)
                    || (item.track.album.images && item.track.album.images[1] && item.track.album.images[1].url)
                    || ''
            }));

        return playableTracks;
    } catch (error) {
        console.error('Error obteniendo playlist de Spotify:', error.message);
        throw new Error('No se pudo obtener la playlist de Spotify');
    }
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return sendJsonError(res, 405, 'Method Not Allowed. Use POST.');
    }

    const contentType = req.headers['content-type'] || req.headers['Content-Type'];
    if (!contentType || !contentType.includes('application/json')) {
        return sendJsonError(res, 400, 'Invalid Content-Type. Expected application/json');
    }

    let { playlistId } = req.body || {};
    if (!playlistId || typeof playlistId !== 'string') {
        return sendJsonError(res, 400, 'Missing or invalid playlistId');
    }
    playlistId = playlistId.trim();

    try {
        // 1. Obtener token de Spotify
        const token = await getSpotifyToken();
        
        // 2. Obtener canciones de la playlist
        const tracks = await fetchTracksFromSpotifyPlaylist(playlistId, token);
        
        if (!tracks.length) {
            return sendJsonError(res, 404, 'No se encontraron canciones con preview en esta playlist');
        }
        
        // 3. Seleccionar una canción aleatoria
        const randomTrack = tracks[Math.floor(Math.random() * tracks.length)];
        
        return res.status(200).json(randomTrack);
        
    } catch (error) {
        const data = error.response?.data || error.message;
        console.error('Error en get-track (Spotify):', data);
        return sendJsonError(
            res, 
            500, 
            'Error al obtener canción de Spotify', 
            typeof data === 'string' ? data : JSON.stringify(data)
        );
    }
};






