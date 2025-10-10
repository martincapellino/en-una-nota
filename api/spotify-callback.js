const axios = require('axios');

module.exports = async (req, res) => {
	const code = req.query.code;
	if (!code) {
		return res.status(400).json({ error: 'Falta parámetro code' });
	}

	const clientId = process.env.SPOTIFY_CLIENT_ID;
	const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
	const redirectUri = process.env.SPOTIFY_REDIRECT_URI || `https://${req.headers.host}/api/spotify-callback`;
	if (!clientId || !clientSecret) {
		return res.status(500).json({ error: 'Faltan credenciales de Spotify en variables de entorno' });
	}

	try {
		const tokenResp = await axios.post(
			'https://accounts.spotify.com/api/token',
			new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				redirect_uri: redirectUri
			}).toString(),
			{
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
				}
			}
		);

		const { access_token, refresh_token, expires_in, token_type } = tokenResp.data;
		return res.status(200).json({
			message: 'Copia SPOTIFY_REFRESH_TOKEN y guárdalo en Vercel',
			refresh_token,
			info: { token_type, expires_in }
		});
	} catch (err) {
		const data = err.response?.data || err.message;
		return res.status(500).json({ error: 'No se pudo intercambiar el code', details: data });
	}
};


