// 1. Correct "language" for Vercel
const axios = require('axios');

// 2. Get credentials from Vercel Environment Variables
const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

// 3. Cache to reuse tokens
let tokenCache = null;
let tokenExpiresAt = 0;

const getAppToken = async () => {
    if (tokenCache && Date.now() < tokenExpiresAt) {
        return tokenCache;
    }
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    
    // 4. CORRECT URL for getting the token
    const tokenResponse = await axios.post('https://accounts.spotify.com/api/token', params.toString(), {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        },
    });
    tokenCache = tokenResponse.data.access_token;
    tokenExpiresAt = Date.now() + (tokenResponse.data.expires_in * 1000);
    return tokenCache;
};

// 5. Correct "language" for Vercel's handler
module.exports = async (req, res) => {
    const { playlistId } = req.body;

    try {
        const token = await getAppToken();
        
        // 6. CORRECT URL for getting the playlist tracks
        const tracksResponse = await axios.get(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const tracks = tracksResponse.data.items;
        const playableTracks = tracks.filter(t => t.track && t.track.preview_url);
        if (playableTracks.length === 0) {
            return res.status(404).json({ error: 'No playable tracks with a preview were found in this playlist.' });
        }
        const randomTrack = playableTracks[Math.floor(Math.random() * playableTracks.length)].track;

        return res.status(200).json({
            name: randomTrack.name,
            artist: randomTrack.artists.map(a => a.name).join(', '),
            preview_url: randomTrack.preview_url,
            album_art: randomTrack.album.images[0].url
        });

    } catch (error) {
        console.error("Error in get-track function:", error.response ? error.response.data : error.message);
        return res.status(500).json({ error: 'The call to Spotify failed from the server function.' });
    }
};




