const axios = require('axios');

function sendJsonError(res, statusCode, message, extra) {
    const payload = { error: message };
    if (extra) payload.details = extra;
    return res.status(statusCode).json(payload);
}

async function fetchTracksViaItunes(searchTerms) {
    const terms = (Array.isArray(searchTerms) && searchTerms.length) ? searchTerms : ['pop','rock','latin'];
    for (const term of terms) {
        try {
            const resp = await axios.get('https://itunes.apple.com/search', {
                timeout: 10000,
                params: { term, entity: 'song', limit: 50 }
            });
            const items = resp.data?.results || [];
            const playable = items.filter(t => t && t.previewUrl);
            if (playable.length > 0) {
                return playable.map(t => ({
                    name: t.trackName,
                    artist: t.artistName,
                    preview_url: t.previewUrl,
                    album_art: t.artworkUrl100
                }));
            }
        } catch (err) {
            console.error('iTunes query failed', term, err.message);
        }
    }
    return [];
}

// Mapear los playlistId existentes a términos iTunes
const playlistIdToItunesTerms = {
    '37i9dQZF1DXcBWIGoYBM5M': ['pop', 'dance pop', 'top hits'],
    '37i9dQZF1DWXRqgorJj26U': ['reggaeton', 'quevedo', 'cruz cafune'],
    '37i9dQZF1DX10zKGVs6_cs': ['pr', 'reggaeton', 'latin pop'],
    'duki_essentials': ['duki', 'trap argentino', 'hip hop argentino', 'reggaeton', 'bizarrap']  // ← AGREGAR ESTA LÍNEA
};

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
        const terms = playlistIdToItunesTerms[playlistId] || [];
        const tracks = await fetchTracksViaItunes(terms);
        if (!tracks.length) {
            return sendJsonError(res, 404, 'No playable tracks found for the requested genre.');
        }
        const t = tracks[Math.floor(Math.random() * tracks.length)];
        return res.status(200).json(t);
    } catch (error) {
        const data = error.response?.data || error.message;
        console.error('Error in get-track function (iTunes):', data);
        return sendJsonError(res, 500, 'The call to iTunes failed from the server function.', typeof data === 'string' ? data : JSON.stringify(data));
    }
};





