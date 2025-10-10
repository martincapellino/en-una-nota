const axios = require('axios');

function setCookie(res, name, value, options = {}) {
    let cookie = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax;`;
    if (options.maxAge) cookie += ` Max-Age=${options.maxAge};`;
    if (options.secure) cookie += ' Secure;';
    res.setHeader('Set-Cookie', cookie);
}

module.exports = async (req, res) => {
    const code = req.query.code;
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    const redirectUri = process.env.SPOTIFY_REDIRECT_URI || 'https://en-una-nota.vercel.app/api/callback';

    if (!code) {
        res.status(400).send('Missing code');
        return;
    }

    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', redirectUri);

    try {
        const tokenResp = await axios.post('https://accounts.spotify.com/api/token', params.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
            },
        });

        const { access_token, refresh_token, expires_in } = tokenResp.data;
        setCookie(res, 'sp_access_token', access_token, { maxAge: expires_in, secure: true });
        setCookie(res, 'sp_refresh_token', refresh_token, { maxAge: 60 * 60 * 24 * 30, secure: true });

        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
    } catch (err) {
        console.error('OAuth callback error:', err.response?.data || err.message);
        res.status(500).send('OAuth exchange failed');
    }
};
