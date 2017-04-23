const remote = require('electron').remote;
const app = remote.app;

const path = require('path');

const forEachAsync = require('forEachAsync').forEachAsync;

const omdbapi = require('omdbapi');
const tmdb = new (require('tmdbapi'))({ apiv3: '5d357768816b32bc2a1f43a06b62cf4c' });

const img_dl = require('image-downloader');
const filewalker = require('filewalker');

var libhash = require('opensubtitles-api/lib/hash.js');
var OS = require('opensubtitles-api');
var OpenSubtitles = new OS({
  useragent:'Movie Monkey v2',
  username: '',
  password: '',
  ssl: true
});

var tmdb_config = {};

var isVideo = function(fileName) {

	let video = ['avi', 'divx', 'flv','mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'swf', 'wmv', 'x264', 'xvid'];

    let x = fileName.split('.');
    let ext = x[x.length - 1];

    if (video.indexOf(ext) > -1)
    	return true;
    else 
    	return false;
}
// Swap this for formatList
var toArray = function(o) { return Object.keys(o).map(k => o[k]) }

export default class MovieMonkey {
	constructor(a, db) {
		this.app = a;
		this.db = db;
		this.hashList = [], this.fileList = [], this.bytesizeList = [];
		this.movies = [], this.episodes = [], this.unidentified = [];

		tmdb.configuration()
		.then((res) => {
			tmdb_config = res['images'];
		}).catch(console.error);
		
		// this.watch();
	}

	insertIntoDB(hash, movie, tmovie, done) {

		let t = this;

		t.app.setState({status: {mode: 1, message: "🎬 "+movie.title+" - Adding..."}});

		t.db.movies.insert({
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

			t.app.setState({status: {mode: 1, message: "👍 "+movie.title+" - Adding..."}});

			// Brag to the user
			t.app.handleChange({});
			done();

		});

	}

	downloadBackdrop(hash, movie, tmovie, done) {

		let t = this;

		t.app.setState({status: {mode: 1, message: "🎬 "+movie.title+" - Downloading backdrop..."}});

		// Get backdrop url
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

		t.app.setState({status: {mode: 1, message: "🎬 "+movie.title+" - Downloading poster..."}});

		// Get poster url
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

			// t.downloadPoster(hash, movie, tmovie, done);
			t.insertIntoDB(hash, movie, tmovie, done);

		}).catch(console.error);

	}

	getOMDbDetails(hash, imdbid, done) {

		let t = this;

		omdbapi.get({id: imdbid}).then(function(movie) {

			if(movie.type == 'movie') {

				t.app.setState({status: {mode: 1, message: "🎬 "+movie.title+" - Fetching details..."}});

				t.getTMDbDetails(hash, movie, done);

			} else {
				done();
			}

		}).catch(console.error);
	}

	checkInDB(hash, imdbid, done) {

		let t = this;

		this.db.movies.find({imdbid: imdbid}).exec(function(err, docs){

			if(docs.length > 0) {

				// Add the bigger file
				let movie = docs[0];
				let bs = t.bytesizeList[t.hashList.indexOf(hash)];

				// Add the smaller file to files db

				if(bs > movie.bytesize)
				{
					t.db.movies.update(
						{imdbid: imdbid},
						{$set: 
							{
								hash: hash, 
								fileName: t.fileList[t.hashList.indexOf(hash)],
								bytesize: t.bytesizeList[t.hashList.indexOf(hash)]
							}
						},
						{},
						function(e, n) {
		        			done();
						});
				}
				else {
					done();
				}

			} else {

				t.getOMDbDetails(hash, imdbid, done); 

			}

		});
	}

	addMovies() {
		let t = this;

		forEachAsync(this.movies, function(next, OSObject, index, array) {

			if(OSObject['MovieKind'] != 'movie') { next(); return; }

			t.app.setState({status: {mode: 1, message: "🎬 "+OSObject['MovieName']+" - Checking..."}});

			t.checkInDB(OSObject['MovieHash'], "tt"+OSObject['MovieImdbID'], next);

		}).then(function() {

			t.app.setState({status: {mode: 0, message: ""}});
			// console.log("Phew everything is done");

			t.unidentified.forEach(function(movie_hash){
				// console.log(movie_hash, t.fileList[t.hashList.indexOf(movie_hash)]);
			});

			// addUnidentified()

		});
	}

	osCheckMovieHash(token) {

		let hlists = [], h = this.hashList.slice(), t = this;
		while(h.length) {
			hlists.push(h.splice(0, 200));
		}

		this.app.setState({status: {mode: 1, message: "🎞 Identifying your movies..."}});

		forEachAsync(hlists, function(next, hlist, index, array) {

			OpenSubtitles.api.CheckMovieHash(token, hlist).then( (movies_result) => {

				let r = movies_result['data'];

				// Convert ugly object into pretty array
				for (var key in r) {			// if (r.hasOwnProperty(key))
					if (r[key].hasOwnProperty('MovieHash')) {
						if (r[key]['MovieKind'] == 'movie') {
							t.movies.push(r[key]);
						} else if (r[key]['MovieKind'] == 'episode') {
							t.episodes.push(r[key]);
						} else {
							console.log(r[key]);
						}
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

		this.app.setState({status: {mode: 1, message: "🕊 Contacting OpenSubtitles.org server..."}});

		// Login to OSDb
		OpenSubtitles.api.LogIn("", "", "en", "Movie Monkey v1").then((result) => {

			t.osCheckMovieHash(result['token']);

		}).catch(console.error);

	}

	processFiles(fl) {
		let t = this, count = 0;
		this.fileList = fl.slice();

		forEachAsync(fl, function(next, fileName, index, array) {

			// Calculate Hash and Bytesize of video files
			t.db.movies.find({fileName: fileName}).exec(function(err, docs) {
			  	if(docs.length == 0)
			  	{
			  		t.app.setState({status: {mode: 1, message: "✨ Processing "+fileName}});

			  		libhash.computeHash( fileName ).then(function(infos){

			  			if (t.hashList.indexOf(infos['moviehash']) > -1) {
			  				// console.log("This hash", infos['moviehash']," exists", fileName);
			  				// Insert into files db
			  				// {filename, type: duplicate, hash}
			  			}
			  			else {	
				  			t.hashList.push(infos['moviehash']);
				  			t.bytesizeList.push(infos['moviebytesize']);
			  			}

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

	watch() {

		let t = this;

		t.db.watchfolders.find({}).exec(function(e, docs){

			let fl = [];

			// forEachAsync(docs, function(next, watchfolder, index, array){

			// 	filewalker(watchfolder.path)
			// 		.on('file', function(p, s) {
			// 			if( isVideo(p) )
			// 		    	fl.push( path.join(watchfolder.path, p) );
			// 	    })
			// 		.on('error', function(err) {
			// 			console.error(err);
			// 		})
			// 		.on('done', function() {
			// 			next();
			// 		})
			// 		.walk();


			// }).then(function() {

			// 	t.processFiles(fl);

			// });

		});
	}
}
