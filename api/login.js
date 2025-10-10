const querystring = require('querystring');

module.exports = async (req, res) => {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const redirectUri = process.env.SPOTIFY_REDIRECT_URI || 'https://en-una-nota.vercel.app/api/callback';

    const scopes = [
        'playlist-read-private',
        'playlist-read-collaborative'
    ];

    const state = Math.random().toString(36).slice(2);

    const params = querystring.stringify({
        response_type: 'code',
        client_id: clientId,
        scope: scopes.join(' '),
        redirect_uri: redirectUri,
        state
    });

    res.statusCode = 302;
    res.setHeader('Location', `https://accounts.spotify.com/authorize?${params}`);
    res.end();
};
