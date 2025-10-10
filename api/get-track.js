// Use 'require' which is the standard for this Node.js environment
const axios = require('axios');

// Get the credentials from Vercel's secure Environment Variables
const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

// A small in-memory cache to reuse the app token and avoid asking for a new one on every click
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

    // Make the call to Spotify to get an app token. This URL is correct.
    const tokenResponse = await axios.post('https://accounts.spotify.com/api/token', params.toString(), {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        },
    });

    tokenCache = tokenResponse.data.access_token;
    // Calculate when the token expires (usually in 1 hour) and store it
    tokenExpiresAt = Date.now() + (tokenResponse.data.expires_in * 1000);
    return tokenCache;
};

// This is the main function that Vercel will run when called at /api/get-track
module.exports = async (req, res) => {
    // Get the playlist ID from the request sent by the frontend
    const { playlistId } = req.body;

    try {
        const token = await getAppToken();
        
        // Use the token to request the tracks from the specified playlist. This URL is correct.
        const tracksResponse = await axios.get(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const tracks = tracksResponse.data.items;
        // Filter out any tracks that do not have an audio preview
        const playableTracks = tracks.filter(t => t.track && t.track.preview_url);

        if (playableTracks.length === 0) {
            // If no songs have a preview, send a specific error
            return res.status(404).json({ error: 'No playable tracks with a preview were found in this playlist.' });
        }
        
        // Pick a random track from the filtered list
        const randomTrack = playableTracks[Math.floor(Math.random() * playableTracks.length)].track;

        // Send the clean track data back to the frontend
        return res.status(200).json({
            name: randomTrack.name,
            artist: randomTrack.artists.map(a => a.name).join(', '),
            preview_url: randomTrack.preview_url,
            album_art: randomTrack.album.images[0].url
        });

    } catch (error) {
        // If anything fails, log the detailed error on the server for debugging
        console.error("Error in get-track function:", error.response ? error.response.data : error.message);
        // And send a generic error back to the user
        return res.status(500).json({ error: 'The call to Spotify failed from the server function.' });
    }
};

