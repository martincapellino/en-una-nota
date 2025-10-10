// Use 'require' which is the standard for this Node.js environment
const axios = require('axios');

// Get the credentials from Vercel's secure Environment Variables
const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

// A small in-memory cache to reuse the app token
let tokenCache = null;
let tokenExpiresAt = 0;

// Function to get an app token (Client Credentials Flow)
const getAppToken = async () => {
    // If we have a valid token in our cache, reuse it
    if (tokenCache && Date.now() < tokenExpiresAt) {
        return tokenCache;
    }

    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');

    // **CORRECTION #1: The URL to get the token was wrong.**
    const tokenResponse = await axios.post('https://accounts.spotify.com/api/token', params.toString(), {
        headers: {
            'Content-Type': 'application/x-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        },
    });

    tokenCache = tokenResponse.data.access_token;
    tokenExpiresAt = Date.now() + (tokenResponse.data.expires_in * 1000);
    return tokenCache;
};

// This is the main function that Vercel will run
module.exports = async (req, res) => {
    const { playlistId } = req.body;

    try {
        const token = await getAppToken();
        
        // **CORRECTION #2: The URL to get the playlist tracks was wrong.**
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

