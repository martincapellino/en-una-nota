const querystring = require('querystring');

module.exports = (req, res) => {
	const clientId = process.env.SPOTIFY_CLIENT_ID;
	const redirectUri = process.env.SPOTIFY_REDIRECT_URI || `https://${req.headers.host}/api/spotify-callback`;
	if (!clientId) {
		return res.status(500).json({ error: 'Falta SPOTIFY_CLIENT_ID en variables de entorno' });
	}

	const scope = [
		'playlist-read-private',
		'playlist-read-collaborative'
	].join(' ');

	const params = querystring.stringify({
		response_type: 'code',
		client_id: clientId,
		scope,
		redirect_uri: redirectUri,
		show_dialog: 'true'
	});

	const authorizeUrl = `https://accounts.spotify.com/authorize?${params}`;
	res.setHeader('Cache-Control', 'no-store');
	return res.redirect(authorizeUrl);
};


