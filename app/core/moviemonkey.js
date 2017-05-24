const remote = require('electron').remote;
const app = remote.app;

const path = require('path');

const forEachAsync = require('forEachAsync').forEachAsync;

const omdbapi = require('omdbapi');
const tmdb = new (require('tmdbapi'))({ apiv3: '5d357768816b32bc2a1f43a06b62cf4c' });

const img_dl = require('image-downloader');
const filewalker = require('filewalker');
const episode_parser = require('episode-parser');

var libhash = require('opensubtitles-api/lib/hash.js');
var OS = require('opensubtitles-api');
var OpenSubtitles = new OS({
  useragent:'Movie Monkey v2',
  username: '',
  password: '',
  ssl: true
});

var tmdb_config = {};

tmdb.configuration()
.then((res) => {
	tmdb_config = res['images'];
}).catch(console.error);

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
var toArray = function(o) { 
	if(o[0] == null) return null;

	return Object.keys(o).map(k => o[k])
}

export default class MovieMonkey {
	constructor(db, updateStatus) {
		this.db = db;
		this.updateStatus = updateStatus;
		this.hashList = [], this.fileList = [], this.bytesizeList = [];
		this.movies = [], this.episodes = [], this.unidentified = [];
		this.showStatus = true;
	}

	insertIntoDB(movie_file, movie, tmovie, done) {

		let t = this;

		if(t.showStatus)
			t.updateStatus({status: {mode: 1, message: "🎬 "+movie.title+" - Adding..."}});

		let M = {}

		M.tmdb_id = tmovie['id'];

		M.imdbid = movie.imdbid;
		M.imdbrating = +movie.imdbrating;
		M.imdbvotes = +movie.imdbvotes;

		M.actors = (movie.actors) ? toArray(movie.actors) : null;
		M.awards = movie.awards;
		M.boxoffice = movie.boxoffice;
		M.country = (movie.country) ? toArray(movie.country) : null;
		M.directors = (movie.director) ? toArray(movie.director) : null;
		M.dvd = movie.dvd;
		M.genres = (movie.genre) ? toArray(movie.genre) : null;
		// M.language = movie.language.split(', ');
		M.plot = movie.plot;
		M.production = movie.production;
		M.rated = movie.rated;
		M.released = new Date(movie.released);
		M.runtime = +movie.runtime.split(" min")[0];
		M.title = movie.title;
		M.type = movie.type;
		M.writers = (movie.writer) ? toArray(movie.writer) : null;
		// M.year = isNaN(movie.year) ? movie.year : +movie.year;
		M.year = movie.year;

		M.ratings = movie.ratings;
		M.metacritic = movie.metascore;

		if (movie.type == 'movie') {

			M.poster_path = tmovie['poster_path'];
			M.backdrop_path = tmovie['backdrop_path'];

			M.hash = movie_file.hash;
			M.fileName = movie_file.fileName;
			M.bytesize = movie_file.bytesize;

		} else if (movie.type == 'episode') {

			M.still_path = tmovie['still_path'];

			M.hash = movie_file.hash;
			M.fileName = movie_file.fileName;
			M.bytesize = movie_file.bytesize;

			M.season = movie.season;
			M.episode = movie.episode;

			M.seriesid = movie.seriesid;

		} else if (movie.type == 'series') {

			M.poster_path = tmovie['poster_path'];
			M.backdrop_path = tmovie['backdrop_path'];

			M.totalseasons = +movie.totalseasons;
		}

		t.db.movies.insert(M, function(err, newDoc) {

			if(t.showStatus)
				t.updateStatus({status: {mode: 1, message: "👍 "+movie.title+" - Added"}}, newDoc);

			if(M.type == 'movie' || M.type == 'episode') {

				t.db.files.update(
					{ path: movie_file.fileName },
					{
						path: movie_file.fileName,
						type: "movie",
						hash: movie_file.hash,
						bytesize: movie_file.bytesize
					}, 
					{upsert: true}, 
					function(e, newDoc, u) {
						done();
					});

			} else {
				done();
			}

		});

	}

	downloadBackdrop(movie_file, movie, tmovie, done) {

		let t = this;

		if(t.showStatus)
			t.updateStatus({status: {mode: 1, message: "🎬 "+movie.title+" - Downloading backdrop..."}});

		// Get backdrop url
		let tbackdrop = tmdb_config['base_url'] + "original" + tmovie['backdrop_path'];

		img_dl({
			url: tbackdrop,
			dest: path.join(app.getPath('userData'), 'backdrops'),
			done: function(e, f, i) {

				t.insertIntoDB(movie_file, movie, tmovie, done);

			}
		});
	}

	downloadPoster(movie_file, movie, tmovie, done) {

		let t = this;

		if(t.showStatus)
			t.updateStatus({status: {mode: 1, message: "🎬 "+movie.title+" - Downloading poster..."}});

		// Get poster url
		let tposter = tmdb_config['base_url'] + "w500" + tmovie['poster_path'];

		img_dl({
			url: tposter,
			dest: path.join(app.getPath('userData'), 'posters'),
			done: function(e, f, i) {

				t.downloadBackdrop(movie_file, movie, tmovie, done);

			}
		});

	}

	downloadStill(movie_file, movie, tmovie, done) {

		let t = this;

		if(t.showStatus)
			t.updateStatus({status: {mode: 1, message: "🎬 "+movie.title+" - Downloading still..."}});

		// Get poster url
		let tposter = tmdb_config['base_url'] + "w500" + tmovie['still_path'];

		img_dl({
			url: tposter,
			dest: path.join(app.getPath('userData'), 'stills'),
			done: function(e, f, i) {

				t.insertIntoDB(movie_file, movie, tmovie, done);

			}
		});

	}

	addTvShow(movie_file, movie, tmovie, done) {

		let t = this;

		t.db.movies.find({imdbid: movie.seriesid}).exec(function(err, docs){

			if(docs.length == 0) {

				t.addMovie("", movie.seriesid, {}, function(){

					t.downloadStill(movie_file, movie, tmovie, done);
				});

			} else {

				t.downloadStill(movie_file, movie, tmovie, done);

			}

		});
	}

	getTMDbDetails(movie_file, movie, done) {

		let t = this;

		tmdb.find({external_id: movie.imdbid, external_source: 'imdb_id' }).then(function(res) {

			if(res.movie_results.length > 0) {

				let tmovie = res.movie_results[0];
				t.downloadPoster(movie_file, movie, tmovie, done);

			} else if(res.tv_episode_results.length > 0) {

				let tmovie = res.tv_episode_results[0];
				t.addTvShow(movie_file, movie, tmovie, done);

			} else if(res.tv_results.length > 0){

				let tmovie = res.tv_results[0];
				t.downloadPoster(movie_file, movie, tmovie, done);

			} else {
				done();
			}

		}).catch(console.error);

	}

	checkInDB(movie_file, movie, done) {
		// bytesizeList
		// fileList

		let t = this;

		this.db.movies.find({imdbid: movie.imdbid}).exec(function(err, docs){

			if(movie.type != 'series' && docs.length > 0) {

				let m = docs[0];
				let bs = movie_file.bytesize;

				t.updateStatus({status: {mode: 1, message: "🎬 "+movie.title+" - Movie already exists."}});

				// Add the bigger file to movies db
				// Add the smaller file to files db
				if(bs > m.bytesize)
				{
					t.db.movies.update(
						{imdbid: movie.imdbid},
						{$set: 
							{
								hash: movie_file.hash, 
								fileName: movie_file.fileName,
								bytesize: movie_file.bytesize
							}
						},
						{},
						function(e, n) {
							t.db.files.update({path:m.fileName}, {
								path: m.fileName,
								type: "duplicate",
								hash: m.hash,
								bytesize: m.bytesize
							}, {upsert: true}, function(e, newDoc, u) {

								t.db.files.update({path:movie_file.fileName}, {
									path: movie_file.fileName,
									type: "movie",
									hash: movie_file.hash,
									bytesize: movie_file.bytesize
								}, {upsert: true}, function(e, newDoc, u) {
									done();
								});

							});
						});

				} else {

					t.db.files.update({path:movie_file.fileName}, {
						path: movie_file.fileName,
						type: "duplicate",
						hash: movie_file.hash,
						bytesize: movie_file.bytesize
					}, {upsert: true}, function(e, newDoc, u) {
						done();
					});
				}
			} else {

				t.getTMDbDetails(movie_file, movie, done);

			}

		});
	}

	addMovie(title, imdbid, movie_file, done) {

		let t = this;

		omdbapi.get({title: title, id: imdbid, apikey: "d1e90517"}).then(function(movie) {

			if(movie.type == 'movie' || movie.type == 'episode' || movie.type == 'series') {

				if(t.showStatus)
					t.updateStatus({status: {mode: 1, message: "🎬 "+movie.title+" - Fetching details..."}});

				let ep = null

				if(movie.type == 'episode') {
					ep = episode_parser(movie_file.fileName)
				}

				if(ep != null && (ep.season != movie.season || ep.episode != movie.episode)) {

					omdbapi.get({id: movie.seriesid, season: ep.season, episode: ep.episode, apikey: "d1e90517"}).then(function(new_movie) {

						console.log("this matches", new_movie.title);
						t.checkInDB(movie_file, new_movie, done);

					}).catch(console.error);

				} else {

					t.checkInDB(movie_file, movie, done);

				}

			} else {

				done();
			}

		}).catch(console.error);
	}

	addUnidentified() {
		let t = this;

		forEachAsync(t.unidentified, function(next, movie_hash, index, array) {

			t.db.files.insert({
				path: t.fileList[t.hashList.indexOf(movie_hash)],
				bytesize: t.bytesizeList[t.hashList.indexOf(movie_hash)],
				type: "unidentified",
				hash: movie_hash
			}, function(e, newDoc) {
				next();
			});
		}).then(function(){
			if(t.unidentified.length > 0)
				t.updateStatus({status: {mode: 2, message: "Some files could not be identified automatically. Click here to identify them manually."}})
		});
	}

	addMovies() {
		let t = this;

		forEachAsync(this.movies, function(next, OSObject, index, array) {

			let movie_file = {
				hash: OSObject['MovieHash'],
				fileName: t.fileList[t.hashList.indexOf(OSObject['MovieHash'])],
				bytesize: t.bytesizeList[t.hashList.indexOf(OSObject['MovieHash'])]
			}

			// To-do: write a better conditional
			if(OSObject['MovieKind'] != 'movie' && OSObject['MovieKind'] != 'episode') { next(); return; }

			if(t.showStatus)
				t.updateStatus({status: {mode: 1, message: "🎬 "+OSObject['MovieName']+" - Checking..."}});

			t.addMovie("", "tt"+OSObject['MovieImdbID'], movie_file, next);

		}).then(function() {

			t.updateStatus({status: {mode: 0, message: ""}});
			t.addUnidentified()

		});
	}

	osCheckMovieHash(token) {

		let hlists = [], h = this.hashList.slice(), t = this;

		while(h.length) {
			hlists.push(h.splice(0, 200));
		}

		if(t.showStatus)
			this.updateStatus({status: {mode: 1, message: "🎞 Identifying your movies..."}});

		forEachAsync(hlists, function(next, hlist, index, array) {

			OpenSubtitles.api.CheckMovieHash(token, hlist).then( (movies_result) => {

				let r = movies_result['data'];

				// Convert ugly object into pretty array
				for (var key in r) {			// if (r.hasOwnProperty(key))
					if (r[key].hasOwnProperty('MovieHash')) {
						if (r[key]['MovieKind'] == 'movie' || r[key]['MovieKind'] == 'episode') {
							t.movies.push(r[key]);
						} else {
							console.log(r[key]);
						}
					}
					else {
						t.unidentified.push(key);	// Process unidentified movies separately
					}
				}

				next();
			}).catch(console.error); // Check hash error
		}).then(function(){

			// Send movies, episodes and unidentified
			t.addMovies();

		});

	}

	osLogin() {

		let t = this;

		if(t.showStatus)
			this.updateStatus({status: {mode: 1, message: "🕊 Contacting OpenSubtitles.org server..."}});

		// Login to OSDb
		OpenSubtitles.api.LogIn("", "", "en", "Movie Monkey v1").then((result) => {

			// Send lists
			t.osCheckMovieHash(result['token']);

		}).catch(console.error);

	}

	processFiles(fl, discreet) {

		let t = this, count = 0;
		this.fileList = fl.slice();
		this.hashList = [];
		this.bytesizeList = [];
		
		this.movies = [], this.episodes = [], this.unidentified = [];

  		if(!discreet)
	  		t.updateStatus({status: {mode: 1, message: "✨ Processing "+fl.length+" files..."}});

		forEachAsync(fl, function(next, fileName, index, array) {

			// Calculate Hash and Bytesize of video files
			t.db.files.find({path: fileName}).exec(function(err, docs) {
			  	if(docs.length == 0)
			  	{
			  		// if(t.showStatus)
				  	// 	t.updateStatus({status: {mode: 1, message: "✨ Processing "+fileName}});

			  		libhash.computeHash( fileName ).then(function(infos){

			  			// To-do: also check if hash exists in filesdb
			  			if (t.hashList.indexOf(infos['moviehash']) > -1) {

			  				t.db.files.update({path:fileName}, {
			  					path: fileName,
			  					type: "duplicate",
			  					hash: infos['moviehash']
			  				}, {upsert: true}, function(e, newDoc, u) {
						  		t.fileList.splice(t.fileList.indexOf(fileName), 1);
			  					next();
			  				});

			  			}
			  			else {	
				  			t.hashList.push(infos['moviehash']);
				  			t.bytesizeList.push(infos['moviebytesize']);
				  			next();
			  			}
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
			if(t.fileList.length > 0)
				t.osLogin();
			else
				t.updateStatus({status: {mode: 0, message: ""}});
		});
	}

	watch() {

		let t = this;

		t.db.watchfolders.find({}).exec(function(e, docs){

			let fl = [];

			forEachAsync(docs, function(next, watchfolder, index, array){

				filewalker(watchfolder.path)
					.on('file', function(p, s) {
						if( isVideo(p) )
					    	fl.push( path.join(watchfolder.path, p) );
				    })
					.on('error', function(err) {
						console.error(err);
					})
					.on('done', function() {
						next();
					})
					.walk();


			}).then(function() {

				t.processFiles(fl, true);

			});

		});
	}
}
