const axios = require('axios');

module.exports = async (req, res) => {
	const clientId = process.env.SPOTIFY_CLIENT_ID;
	const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
	const envRefresh = process.env.SPOTIFY_REFRESH_TOKEN;
	const cookieHeader = req.headers.cookie || '';
	const cookieRefresh = (cookieHeader.match(/spotify_refresh_token=([^;]+)/) || [])[1];
	const refreshToken = envRefresh || cookieRefresh;
	if (!clientId || !clientSecret) return res.status(500).json({ error: 'Missing client credentials' });
	if (!refreshToken) return res.status(400).json({ error: 'Missing refresh token' });
	try {
		const tokenResp = await axios.post(
			'https://accounts.spotify.com/api/token',
			new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
			{ headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64') } }
		);
		return res.status(200).json({ access_token: tokenResp.data.access_token, expires_in: tokenResp.data.expires_in, token_type: tokenResp.data.token_type });
	} catch (e) {
		const data = e.response?.data || e.message;
		return res.status(500).json({ error: 'failed to mint access token', details: data });
	}
};


