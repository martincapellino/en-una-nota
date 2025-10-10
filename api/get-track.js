const axios = require('axios');

// 🔑 CREDENCIALES DE SPOTIFY
const SPOTIFY_CLIENT_ID = '703d482e19fb400788f84305b589d41d';
const SPOTIFY_CLIENT_SECRET = '4716afe5dcde425c97e5737c7218f36b';

function sendJsonError(res, statusCode, message, extra) {
    const payload = { error: message };
    if (extra) payload.details = extra;
    return res.status(statusCode).json(payload);
}

// Obtener token de acceso de Spotify
async function getSpotifyToken() {
    try {
        const response = await axios.post(
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
        return response.data.access_token;
    } catch (error) {
        console.error('Error obteniendo token de Spotify:', error.message);
        throw new Error('No se pudo autenticar con Spotify');
    }
}

// Obtener canciones de una playlist de Spotify
async function fetchTracksFromSpotifyPlaylist(playlistId, token) {
    try {
        const response = await axios.get(
            `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
            {
                headers: { 'Authorization': `Bearer ${token}` },
                params: { limit: 100 }, // Obtener hasta 100 canciones
                timeout: 10000
            }
        );

        const items = response.data.items || [];
        
        // Filtrar solo las canciones que tienen preview_url disponible
        const playableTracks = items
            .filter(item => item.track && item.track.preview_url)
            .map(item => ({
                name: item.track.name,
                artist: item.track.artists.map(a => a.name).join(', '),
                preview_url: item.track.preview_url,
                // Spotify tiene 3 tamaños: 640x640, 300x300, 64x64
                // Usamos la imagen más grande disponible
                album_art: item.track.album.images[0]?.url || item.track.album.images[1]?.url || ''
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






