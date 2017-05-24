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

import MovieMonkey from './core/moviemonkey.js'

const remote = require('electron').remote;
const app = remote.app;
const ipcRenderer = require('electron').ipcRenderer;

const fs = require('fs');
const path = require('path');
const url = require('url');

const mkdirp = require('mkdirp');
const filewalker = require('filewalker');
var forEachAsync = require('forEachAsync').forEachAsync;

var db = {}, MM;

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


class App extends React.Component {

	constructor(props) {
		super(props);
	    this.genreChange = this.genreChange.bind(this);
	    this.searchChange = this.searchChange.bind(this);
	    this.sortChange = this.sortChange.bind(this);
	    this.typeChange = this.typeChange.bind(this);
	    this.updateStatus = this.updateStatus.bind(this);
	    this.handleChange = this.handleChange.bind(this);
	    this.onDrop = this.onDrop.bind(this);
	    this.importMovies = this.importMovies.bind(this);
	    this.hideSidebar = this.hideSidebar.bind(this);
	    this.hideMovieDetails = this.hideMovieDetails.bind(this);
	    this.openUnidentifiedWindow = this.openUnidentifiedWindow.bind(this);

		this.state = {
			allgenres: ['Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'Film-Noir', 'History', 'Horror', 'Music', 'Musical', 'Mystery', 'Romance', 'Sci-Fi', 'Sport', 'Thriller', 'War', 'Western'],
		  	genres: ['All'],
    		search: "",
    		type: "movie",
    		sortby: ['title', 1],
    		data: [],
    		showmoviedetails: false,
    		movie: {},
    		episodes: [],
    		status: {
    			mode: 0,
    			message: ""
    		}
    	};

    	var t = this;
    	this.genres = {};
    	this.genres['movie'] = ['Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'Film-Noir', 'History', 'Horror', 'Music', 'Musical', 'Mystery', 'Romance', 'Sci-Fi', 'Sport', 'Thriller', 'War', 'Western'];
    	this.genres['series'] = ['Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'Film-Noir', 'History', 'Horror', 'Music', 'Musical', 'Mystery', 'Romance', 'Sci-Fi', 'Sport', 'Thriller', 'War', 'Western'];

		mkdirp( path.join(app.getPath('userData'), 'posters') );
		mkdirp( path.join(app.getPath('userData'), 'backdrops') );
		mkdirp( path.join(app.getPath('userData'), 'stills') );

		// TO DO: Handle genres better with a genres.db
		db.movies = new Datastore({ filename: path.join(app.getPath('userData'), 'data/movies.json'), autoload: true });
		db.watchfolders = new Datastore({ filename: path.join(app.getPath('userData'), 'data/watchfolders.json'), autoload: true });
		db.files = new Datastore({ filename: path.join(app.getPath('userData'), 'data/files.json'), timestampData: true, autoload: true });

		MM = new MovieMonkey(db, this.updateStatus);

	  	db.movies.find({type: t.state.type}).sort({ title: 1 }).exec(function (err, docs) {
	  		t.setState({data: docs});
	  	});

	  	t.genres['movie'].forEach(function(item, index){
		  	db.movies.find({genres: { $elemMatch: item }, type: "movie" }).exec(function (err, docs) {
		  		if(docs.length == 0) {
		  			t.genres['movie'].splice(t.genres['movie'].indexOf(item), 1);
		  			t.setState({allgenres: t.genres['movie']});
		  		}
		  	});
	  	});

	  	t.genres['series'].forEach(function(item, index){
		  	db.movies.find({genres: { $elemMatch: item }, type: "series" }).exec(function (err, docs) {
		  		if(docs.length == 0) {
		  			t.genres['series'].splice(t.genres['series'].indexOf(item), 1);
		  		}
		  	});
	  	});

	  	MM.watch();

		ipcRenderer.on('import-movies', (event, filePaths) => {
			t.importMovies(filePaths)
		})
	}

	onDragOver(e) {
		e.preventDefault();
	}

	onDrop(e) {
	    e.preventDefault();

	    let filePaths = [], t = this;

		forEachAsync(e.dataTransfer.files, function(next, f, index, array){
			filePaths.push(f.path);
			next();
		}).then(function() {
		    t.importMovies(filePaths);
		    return false;
		});
	}

	importMovies(filePaths) {

		this.setState({status: {mode: 1, message: "🔍 Scanning your files..."}});

		let fileList = [];

		forEachAsync(filePaths, function(next, fp, index, array){

			if( fs.lstatSync(fp).isFile() && isVideo(fp) ) {
				fileList.push( fp );
				next();
			}
			else if ( fs.lstatSync(fp).isDirectory() ) {

				// Add to watchfolders, and remove subdirectories from being watched
				db.watchfolders.update(
					{path: fp},
					{path: fp},
					{upsert: true},
					function(e, n, u) {});

				filewalker(fp)
					.on('file', function(p, s) {
						if( isVideo(p) )
					    	fileList.push( path.join(fp, p) );
				    })
				    .on('dir', function(p) {

						db.watchfolders.remove({ 
							path: path.join(fp, p) }, 
							{}, 
							function (e, n) {});
				    })
					.on('error', function(err) {
						console.error(err);
					})
					.on('done', function() {
						next();
					})
					.walk();
			}
			else { next(); }

		}).then(function() {

			MM.processFiles(fileList);

		});
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

	typeChange(type) {
		let t = this;

    	this.state.type = type;
    	this.state.allgenres = this.genres[type];

	    let selectedGenres = this.state.genres;

	    selectedGenres.forEach(function(selGenre) {
	    	if(selGenre != 'All'){

				if(t.state.allgenres.indexOf(selGenre) == -1){

					t.state.genres.splice(t.state.genres.indexOf(selGenre), 1);

				    if(t.state.genres.length == 0){

				    	t.state.genres.push('All');
				    }
				}
	    	}

	    });

	    t.setState({genres: t.state.genres});

    	this.handleChange();
	}

	updateStatus(status, movie) {
		let t = this;

		t.setState(status);

		if(movie) {
			// Update any new genres
			if(movie.type == 'movie' || movie.type == 'series') {

				let g = t.genres[movie.type].slice();  

				movie.genres.forEach(function(genre){
					if(t.genres[movie.type].indexOf(genre) == -1) {  
						g.push(genre);
						g.sort();
					}
				});

				t.genres[movie.type] = g.slice();

				if (t.state.type == movie.type) {
			    	t.state.allgenres = g;
				}
			}

			this.handleChange();
		}
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

		db.movies.find({$and: [genreQuery, searchQuery, {type: t.state.type}]}).sort(sorting).exec(function (err, docs) {
			t.setState({data: docs});
		});

		if(t.state.showmoviedetails == true) {
			let movie = t.state.movie;
			
			db.movies.find({seriesid: movie.imdbid}).exec(function (err, episodes) {
				movie.episodes = episodes;
				t.setState({movie: movie, showmoviedetails: true});
			});
		}
	}

	// Hide sidebar
	hideSidebar(e) {
	    var t = this;
		db.movies.find({imdbid: e.currentTarget.id}).exec(function (err, docs) {

			let movie = docs[0];

			if(movie.type == "series") {

				db.movies.find({seriesid: movie.imdbid}).exec(function (err, episodes) {
					movie.episodes = episodes;
					t.setState({movie: movie, showmoviedetails: true});
				});

			} else {
				t.setState({movie: movie, showmoviedetails: true});
			}
		});
	}

	// Hide movie details
	hideMovieDetails(e) {
	    this.setState({showmoviedetails: false});
	}

	openUnidentifiedWindow(e) {
		if (this.state.status.mode == 2) {
			ipcRenderer.send('open-unwindow');
		}
		this.setState({status: {mode: 0, message: ""}});
	}

	render() {
		return (
			<div id="wrap" onDragOver={this.onDragOver} onDrop={this.onDrop} >
			  <Topbar 
			  	searchQuery={this.state.search} 
			  	onSearchChange={this.searchChange}
			  	sortBy={this.state.sortby}
			  	onSortChange={this.sortChange}
			  	onTypeChange={this.typeChange}
			  	 className={(this.state.showmoviedetails) ? 'hide' : ''}
			  	 />
				<div id="main" className={(this.state.showmoviedetails) ? 'hide' : ''}>
				
					<Sidebar 
						allGenres={this.state.allgenres} 
						selectedGenres={this.state.genres} 
						onGenreChange={this.genreChange} 
						isMovieDetailsShown={this.state.showmoviedetails} />

						<div id="movie-grid">
				  <MoviesPanel data={this.state.data} onMovieSelect={this.hideSidebar} />
				  <Statusbar status={this.state.status} onClick={this.openUnidentifiedWindow} />
					  </div>
				</div>
				<div id="movie-details" className={(this.state.showmoviedetails) ? '' : 'hide'}>
					<MovieDetails 
						movie={this.state.movie} 
						episodes={this.state.episodes} 
						onHideMovieDetails={this.hideMovieDetails}
						onBack={this.hideMovieDetails}  />
				</div>
			</div>
		);
	}
}

ReactDOM.render(
	<App/>,
	document.getElementById('app')
);