const axios = require('axios');

const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

let tokenCache = null;
let tokenExpiresAt = 0;

const getAppToken = async () => {
    if (tokenCache && Date.now() < tokenExpiresAt) {
        return tokenCache;
    }
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    const tokenResponse = await axios.post('accounts.spotify.com', params.toString(), {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        },
    });
    tokenCache = tokenResponse.data.access_token;
    tokenExpiresAt = Date.now() + (tokenResponse.data.expires_in * 1000);
    return tokenCache;
};

module.exports = async (req, res) => {
    const { playlistId } = req.body;

    try {
        const token = await getAppToken();
        
        // ¡¡ESTA ES LA LÍNEA CORREGIDA!!
        const tracksResponse = await axios.get(`spotify.com/`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const tracks = tracksResponse.data.items;
        const playableTracks = tracks.filter(t => t.track && t.track.preview_url);
        if (playableTracks.length === 0) {
            return res.status(404).json({ error: 'No se encontraron canciones con preview en esta playlist.' });
        }
        const randomTrack = playableTracks[Math.floor(Math.random() * playableTracks.length)].track;

        return res.status(200).json({
            name: randomTrack.name,
            artist: randomTrack.artists.map(a => a.name).join(', '),
            preview_url: randomTrack.preview_url,
            album_art: randomTrack.album.images[0].url
        });

    } catch (error) {
        console.error("Error en get-track:", error.response ? error.response.data : error.message);
        return res.status(500).json({ error: 'Falló la llamada a Spotify desde la función' });
    }
};
