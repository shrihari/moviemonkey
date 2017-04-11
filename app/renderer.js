// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// All of the Node.js APIs are available in this process.

import React from 'react'
import ReactDOM from 'react-dom'

import Datastore from 'nedb'

import Movie from './components/movie.js'
import MoviesPanel from './components/moviespanel.js'
import MovieDetails from './components/moviedetails.js'
import Sidebar from './components/sidebar.js'
import Topbar from './components/topbar.js'
import Statusbar from './components/statusbar.js'

const remote = require('electron').remote;
const app = remote.app;

const fs = require('fs');
const path = require('path');
const request = require('request');

const mkdirp = require('mkdirp');
const filewalker = require('filewalker');
var forEachAsync = require('forEachAsync').forEachAsync;

const omdb = require('omdb');
const omdbapi = require('omdbapi');
const tmdb = new (require('tmdbapi'))({ apiv3: '5d357768816b32bc2a1f43a06b62cf4c' });

const img_dl = require('image-downloader');

var OS = require('opensubtitles-api');
var OpenSubtitles = new OS({
  useragent:'Movie Monkey v2',
  username: '',
  password: '',
  ssl: true
});

var movies_db;
var tmdb_config = {};

var toArray = function(o) { return Object.keys(o).map(k => o[k]) }

var isVideo = function(fileName) {

	let video = ['avi', 'divx', 'flv','mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'swf', 'wmv', 'x264', 'xvid'];

    let x = fileName.split('.');
    let ext = x[x.length - 1];

    if (video.indexOf(ext) > -1)
    	return true;
    else 
    	return false;
}

var processFiles = function(files, mainApp) {

	var libhash = require('opensubtitles-api/lib/hash.js');

	let hashList = [], fileList = [], bytesizeList = [];
	// let count = 0;

	mainApp.setState({status: {mode: 1, message: "Scanning your files..."}});
	console.log(files);

	forEachAsync(files, function(next, f, index, array){

		// console.log(count);

		if( fs.lstatSync(f.path).isFile() && isVideo(f.path) ) {
			fileList.push( f.path );
			// count += 1;
			next();
		}
		else if ( fs.lstatSync(f.path).isDirectory() ) {

			filewalker(f.path)
				.on('file', function(p, s) {
					if( isVideo(p) )
				    	fileList.push( path.join(f.path, p) );
			    })
				.on('error', function(err) {
					console.error(err);
				})
				.on('done', function() {
					// count += 1;
					next();
				})
				.walk();
		}
		else { next(); }

	}).then(function(){
		let fl = fileList.slice();

		console.log("Done baby done");
		console.log(fileList, fl);

		forEachAsync(fl, function(next, fileName, index, array) {

			if(fileName) console.log("Yes")
			else console.log("No")

			// Calculate Hash and Bytesize of video files
        	movies_db.find({fileName: fileName}).exec(function(err, docs){
        		if(docs.length == 0)
        		{
					mainApp.setState({status: {mode: 1, message: "Processing "+fileName}});

		        	libhash.computeHash( fileName ).then(function(infos){
		        		hashList.push(infos['moviehash']);
		        		bytesizeList.push(infos['moviebytesize']);
		        		next();
		        	});
        		}
        		else
        		{
        			fileList.splice(fileList.indexOf(fileName), 1);
        			next();
        		}
        	});

		}).then(function(){

			mainApp.setState({status: {mode: 1, message: "Contacting OpenSubtitles.org server..."}});

			// Login to OSDb
			OpenSubtitles.api.LogIn("", "", "en", "Movie Monkey v1").then((result) => {
				// console.log(result);
				// console.log("List of hashes", hashList.length);

				var hlists = [], h = hashList.slice();
				while(h.length) {
					hlists.push(h.splice(0, 200));
				}
				// console.log(hlists, hashList);

				mainApp.setState({status: {mode: 1, message: "Identifying your movies..."}});

				let movies = [];

				forEachAsync(hlists, function(next, hlist, index, array) {
					OpenSubtitles.api.CheckMovieHash(result['token'], hlist).then( (movies_result) => {

						let r = movies_result['data'];
						// TO DO : Process the not-processed and unidentified
						// Convert ugly object into pretty array
						for (var key in r) {			// if (r.hasOwnProperty(key))
							if (r[key].hasOwnProperty('MovieHash')) {
								movies.push(r[key]);
							}
						}

						next();
					}).catch(console.error); // Check hash error
				}).then(function(){

					forEachAsync(movies, function(next, OSObject, index, array) {

						if(OSObject['MovieKind'] != 'movie') { next(); return; }

						// Check if the movie exists. If yes, update the bigger bytesize file. If no, do the usual.

						mainApp.setState({status: {mode: 1, message: "Processing "+OSObject['MovieName']}});

			        	movies_db.find({imdbid: "tt"+OSObject['MovieImdbID']}).exec(function(err, docs){
			        		if(docs.length > 0)
			        		{
			        			let movie = docs[0];
			        			let bs = bytesizeList[hashList.indexOf(OSObject['MovieHash'])];

			        			console.log("Movie already exists, update db", movie.title);
			        			console.log(movie.bytesize, bs);

			        			if(bs > movie.bytesize)
			        			{
				        			movies_db.update(
				        				{imdbid: "tt"+OSObject['MovieImdbID']},
				        				{$set: 
				        					{
												hash: OSObject['MovieHash'], 
												fileName: fileList[hashList.indexOf(OSObject['MovieHash'])],
												bytesize: bytesizeList[hashList.indexOf(OSObject['MovieHash'])]
				        					}
				        				},
				        				{},
				        				function(e, n) {
				        					console.log("updated");
						        			next();
				        				});
			        			}
			        			else
			        				next();
			        		}
			        		else
			        		{
								// Get omdb details
								omdbapi.get({id: "tt"+OSObject['MovieImdbID']}).then(function(movie) {

									if(movie.type == 'movie')
									{
										mainApp.setState({status: {mode: 1, message: "Fetching poster and backdrop of "+movie.title}});

										// Get tmdb details
										tmdb.find({external_id: "tt"+OSObject['MovieImdbID'], external_source: 'imdb_id' })
										.then(function(res) {

											// Get poster and backdrop urls
											let tmovie = res.movie_results[0];
											let tposter = tmdb_config['base_url'] + "w500" + tmovie['poster_path'];
											let tbackdrop = tmdb_config['base_url'] + "original" + tmovie['backdrop_path'];

											mainApp.setState({status: {mode: 1, message: "Downloading poster for "+movie.title}});

											// Download poster
											img_dl({
												url: tposter,
												dest: path.join(app.getPath('userData'), 'posters'),
												done: function(e, f, i) {

													mainApp.setState({status: {mode: 1, message: "Downloading backdrop for "+movie.title}});

													// Download backdrop
													img_dl({
														url: tbackdrop,
														dest: path.join(app.getPath('userData'), 'backdrops'),
														done: function(e, f, i) {

															mainApp.setState({status: {mode: 1, message: "👍 Adding "+movie.title}});

															// Insert into db
															movies_db.insert({
																tmdb_id: tmovie['id'],

																poster_path: tmovie['poster_path'],
																backdrop_path: tmovie['backdrop_path'],

																hash: OSObject['MovieHash'], 
																fileName: fileList[hashList.indexOf(OSObject['MovieHash'])],
																bytesize: bytesizeList[hashList.indexOf(OSObject['MovieHash'])],

																imdbid: "tt"+OSObject['MovieImdbID'],
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

															}, function (err, newDoc) {

																// console.log("Put in db 👍");

																// Update any new genres
																newDoc.genres.forEach(function(genre){
																	if(mainApp.state.allgenres.indexOf(genre) == -1) {
																		mainApp.state.allgenres.push(genre);
																		mainApp.state.allgenres.sort();
																		mainApp.setState({allgenres: mainApp.state.allgenres});
																	}
																});

																mainApp.setState({status: {mode: 1, message: "👍 Added "+movie.title}});

																// Brag to the user
																mainApp.handleChange({});
																next();
															});
														}
													});
												}
											});
										}).catch(console.error);	// Catching tmdb error
									} // IF MOVIE
									else {
										next();
									}

								}).catch(console.error);		// Catching omdb error

			        		}
			        	});


					}).then(function(){
						mainApp.setState({status: {mode: 0, message: ""}});
						console.log("Phew everything is done");
					});

				});

			}).catch(console.error);					// Opensubs login error

		});

	});
}

class App extends React.Component {

	constructor(props) {
		super(props);
	    this.genreChange = this.genreChange.bind(this);
	    this.searchChange = this.searchChange.bind(this);
	    this.sortChange = this.sortChange.bind(this);
	    this.handleChange = this.handleChange.bind(this);
	    this.onDrop = this.onDrop.bind(this);
	    this.hideSidebar = this.hideSidebar.bind(this);
	    this.hideMovieDetails = this.hideMovieDetails.bind(this);

		this.state = {
			allgenres: ['Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'Film-Noir', 'History', 'Horror', 'Music', 'Musical', 'Mystery', 'Romance', 'Sci-Fi', 'Sport', 'Thriller', 'War', 'Western'],
		  	genres: ['All'],
    		search: "",
    		sortby: ['title', 1],
    		data: [],
    		showmoviedetails: false,
    		movie: {},
    		status: {
    			mode: 0,
    			message: ""
    		}
    	};

    	var t = this;

		mkdirp( path.join(app.getPath('userData'), 'posters') );
		mkdirp( path.join(app.getPath('userData'), 'backdrops') );

		movies_db = new Datastore({ filename: path.join(app.getPath('userData'), 'data/movies.json'), autoload: true });
		// TO DO: Handle genres better with a genres.db

	  	movies_db.find({}).sort({ title: 1 }).exec(function (err, docs) {
	  		t.setState({data: docs});
	  	});

		tmdb.configuration()
		.then((res) => {
			tmdb_config = res['images'];
		});

	  	this.state.allgenres.forEach(function(item, index){
	  		if(item != 'All')
			  	movies_db.find({genres: { $elemMatch: item } }).exec(function (err, docs) {
			  		if(docs.length == 0) {
			  			t.state.allgenres.splice(t.state.allgenres.indexOf(item), 1);
			  			t.setState({allgenres: t.state.allgenres});
			  		}
			  	});
	  	});
	}

	onDragOver(e) {
		e.preventDefault();
	}

	onDrop(e) {
	    e.preventDefault();

	    processFiles(e.dataTransfer.files, this);
	    return false;
	}

	genreChange(e) {	
	    var t = this;
    	t.state.genres = e;
    	t.handleChange(e);
	}

	searchChange(e) {
	    var t = this;
    	t.state.search = e;
    	t.handleChange(e);
	}

	sortChange(e) {
	    var t = this;
    	t.state.sortby = e;
    	t.handleChange(e);
	}

	// Update the movie view whenever something happens
	handleChange(e) {
	    var t = this;
	    var genreQuery = {}, searchQuery = {};

	    if(t.state.genres[0] != 'All') {
	     	var ors = []
			for (var i = 0; i < t.state.genres.length; i++) {
				ors.push({genres: { $elemMatch: t.state.genres[i] } });
			}
			genreQuery = {$and: ors};
	    }

	    searchQuery = {$or:
	    	[
	    		{title: new RegExp(t.state.search, "i" )},
	    		{director: new RegExp(t.state.search, "i" )},
	    		{writers: new RegExp(t.state.search, "i" )},
	    		{actors: new RegExp(t.state.search, "i" )},
	    		{plot: new RegExp(t.state.search, "i" )}
	    	]
	    };

	    let sorting = {}
	    sorting[t.state.sortby[0]] = t.state.sortby[1];

		movies_db.find({$and: [genreQuery, searchQuery]}).sort(sorting).exec(function (err, docs) {
			t.setState({data: docs});
		});
	}

	// Hide sidebar
	hideSidebar(e) {
	    var t = this;
		movies_db.find({imdbid: e.currentTarget.id}).exec(function (err, docs) {
			t.setState({movie: docs[0], showmoviedetails: true});
		});
	}

	// Hide movie details
	hideMovieDetails(e) {
	    this.setState({showmoviedetails: false});
	}

	render() {
		return (
			<div id="wrap" onDragOver={this.onDragOver} onDrop={this.onDrop} >
				<Sidebar 
					allGenres={this.state.allgenres} 
					selectedGenres={this.state.genres} 
					onGenreChange={this.genreChange} 
					onBack={this.hideMovieDetails} 
					isMovieDetailsShown={this.state.showmoviedetails} />

				<div id="main" className={(this.state.showmoviedetails) ? 'hide' : ''}>
				  <Topbar 
				  	searchQuery={this.state.search} 
				  	onSearchChange={this.searchChange}
				  	sortBy={this.state.sortby}
				  	onSortChange={this.sortChange}
				  	 />
				  <MoviesPanel data={this.state.data} onMovieSelect={this.hideSidebar} />
				  <Statusbar status={this.state.status} />
				</div>
				<div id="movie-details" className={(this.state.showmoviedetails) ? '' : 'hide'}>
					<MovieDetails movie={this.state.movie} onHideMovieDetails={this.hideMovieDetails} />
				</div>
			</div>
		);
	}
}

ReactDOM.render(
	<App/>,
	document.getElementById('app')
);