const remote = require('electron').remote;
const app = remote.app;

const path = require('path');

const forEachAsync = require('forEachAsync').forEachAsync;

const omdbapi = require('omdbapi');
const tmdb = new (require('tmdbapi'))({ apiv3: '5d357768816b32bc2a1f43a06b62cf4c' });

const img_dl = require('image-downloader');

var libhash = require('opensubtitles-api/lib/hash.js');
var OS = require('opensubtitles-api');
var OpenSubtitles = new OS({
  useragent:'Movie Monkey v2',
  username: '',
  password: '',
  ssl: true
});

var tmdb_config = {};

// Swap this for formatList
var toArray = function(o) { return Object.keys(o).map(k => o[k]) }

export default class MovieMonkey {
	constructor(a, db) {
		this.app = a;
		this.movies_db = db;
		this.hashList = [], this.fileList = [], this.bytesizeList = [];
		this.movies = [], this.unidentified = [];

		tmdb.configuration()
		.then((res) => {
			tmdb_config = res['images'];
		});
	}

	insertIntoDB(hash, movie, tmovie, done) {

		let t = this;

		t.app.setState({status: {mode: 1, message: "👍 Adding "+movie.title}});

		t.movies_db.insert({
			tmdb_id: tmovie['id'],

			poster_path: tmovie['poster_path'],
			backdrop_path: tmovie['backdrop_path'],

			hash: hash, 
			fileName: t.fileList[t.hashList.indexOf(hash)],
			bytesize: t.bytesizeList[t.hashList.indexOf(hash)],

			imdbid: movie.imdbid,
			imdbrating: +movie.imdbrating,
			imdbvotes: +movie.imdbvotes.match(/\d/g).join(''),

			actors: (movie.actors) ? toArray(movie.actors) : null,
			awards: movie.awards,
			boxoffice: movie.boxoffice,
			country: (movie.country) ? toArray(movie.country) : null,
			directors: (movie.director) ? toArray(movie.director) : null,
			dvd: movie.dvd,
			genres: (movie.genre) ? toArray(movie.genre) : null,
			language: movie.language.split(', '),
			plot: movie.plot,
			production: movie.production,
			rated: movie.rated,
			released: new Date(movie.released),
			runtime: +movie.runtime.split(" min")[0],
			title: movie.title,
			type: "movie",
			writers: (movie.writer) ? toArray(movie.writer) : null,
			year: +movie.year,

			// rotten: movie.ratings[1].value.split("%")[0],
			metacritic: movie.metascore,
		}, function(err, newDoc) {

			// Update any new genres
			newDoc.genres.forEach(function(genre){
				if(t.app.state.allgenres.indexOf(genre) == -1) {
					t.app.state.allgenres.push(genre);
					t.app.state.allgenres.sort();
					t.app.setState({allgenres: t.app.state.allgenres});
				}
			});

			t.app.setState({status: {mode: 1, message: "👍 Added "+movie.title}});

			// Brag to the user
			t.app.handleChange({});
			done();

		});

	}

	downloadBackdrop(hash, movie, tmovie, done) {

		let t = this;

		this.app.setState({status: {mode: 1, message: "Downloading backdrop for "+movie.title}});

		let tbackdrop = tmdb_config['base_url'] + "original" + tmovie['backdrop_path'];

		img_dl({
			url: tbackdrop,
			dest: path.join(app.getPath('userData'), 'backdrops'),
			done: function(e, f, i) {

				t.insertIntoDB(hash, movie, tmovie, done);

			}
		});
	}

	downloadPoster(hash, movie, tmovie, done) {

		let t = this;

		// Get poster and backdrop urls
		let tposter = tmdb_config['base_url'] + "w500" + tmovie['poster_path'];

		img_dl({
			url: tposter,
			dest: path.join(app.getPath('userData'), 'posters'),
			done: function(e, f, i) {

				t.downloadBackdrop(hash, movie, tmovie, done);

			}
		});

	}

	getTMDbDetails(hash, movie, done) {

		let t = this;

		tmdb.find({external_id: movie.imdbid, external_source: 'imdb_id' }).then(function(res) {

			let tmovie = res.movie_results[0];

			t.app.setState({status: {mode: 1, message: "Downloading poster for "+movie.title}});

			t.downloadPoster(hash, movie, tmovie, done);

		}).catch(console.error);

	}

	getOMDbDetails(hash, imdbid, done) {

		let t = this;

		omdbapi.get({id: imdbid}).then(function(movie) {

			if(movie.type == 'movie') {

				t.app.setState({status: {mode: 1, message: "Fetching poster and backdrop of "+movie.title}});

				t.getTMDbDetails(hash, movie, done);

			} else {
				done();
			}

		}).catch(console.error);
	}

	checkInDB(hash, imdbid, done) {

		let t = this;

		this.movies_db.find({imdbid: imdbid}).exec(function(err, docs){

			if(docs.length > 0) {

				// Add the bigger file

			} else {

				t.getOMDbDetails(hash, imdbid, done); 

			}

		});
	}

	addMovies() {
		let t = this;

		forEachAsync(this.movies, function(next, OSObject, index, array) {

			if(OSObject['MovieKind'] != 'movie') { next(); return; }

			t.app.setState({status: {mode: 1, message: "Processing "+OSObject['MovieName']}});

			t.checkInDB(OSObject['MovieHash'], "tt"+OSObject['MovieImdbID'], next);

		}).then(function() {

			t.app.setState({status: {mode: 0, message: ""}});
			console.log("Phew everything is done");

			t.unidentified.forEach(function(movie_hash){
				console.log(movie_hash, t.fileList[t.hashList.indexOf(movie_hash)]);
			});

			// addUnidentified()

		});
	}

	osCheckMovieHash(token) {

		let hlists = [], h = this.hashList.slice(), t = this;
		while(h.length) {
			hlists.push(h.splice(0, 200));
		}

		this.app.setState({status: {mode: 1, message: "Identifying your movies..."}});

		forEachAsync(hlists, function(next, hlist, index, array) {

			OpenSubtitles.api.CheckMovieHash(token, hlist).then( (movies_result) => {

				console.log(movies_result);

				let r = movies_result['data'];

				// Convert ugly object into pretty array
				for (var key in r) {			// if (r.hasOwnProperty(key))
					if (r[key].hasOwnProperty('MovieHash')) {
						t.movies.push(r[key]);
					}
					else {
						t.unidentified.push(key);
					}
				}

				next();
			}).catch(console.error); // Check hash error
		}).then(function(){

			t.addMovies();

		});

	}

	osLogin() {

		let t = this;

		this.app.setState({status: {mode: 1, message: "Contacting OpenSubtitles.org server..."}});

		// Login to OSDb
		OpenSubtitles.api.LogIn("", "", "en", "Movie Monkey v1").then((result) => {

			t.osCheckMovieHash(result['token']);

		}).catch(console.error);

	}

	processFiles(fl) {
		let t = this;
		this.fileList = fl.slice();

		forEachAsync(fl, function(next, fileName, index, array) {

			// Calculate Hash and Bytesize of video files
			t.movies_db.find({fileName: fileName}).exec(function(err, docs) {
			  	if(docs.length == 0)
			  	{
			  		t.app.setState({status: {mode: 1, message: "Processing "+fileName}});

			  		libhash.computeHash( fileName ).then(function(infos){
			  			t.hashList.push(infos['moviehash']);
			  			t.bytesizeList.push(infos['moviebytesize']);
			  			next();
			  		});
			  	}
			  	else
			  	{
			  		t.fileList.splice(t.fileList.indexOf(fileName), 1);
			  		next();
			  	}
		  	});

		}).then(function(){
			// Opensubtitles Login
			t.osLogin();
		});
	}
}
