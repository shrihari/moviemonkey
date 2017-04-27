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
const BrowserWindow = remote.BrowserWindow;

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
	    this.handleChange = this.handleChange.bind(this);
	    this.onDrop = this.onDrop.bind(this);
	    this.hideSidebar = this.hideSidebar.bind(this);
	    this.hideMovieDetails = this.hideMovieDetails.bind(this);
	    this.openUnidentifiedWindow = this.openUnidentifiedWindow.bind(this);

		this.state = {
			allgenres: ['Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'Film-Noir', 'History', 'Horror', 'Music', 'Musical', 'Mystery', 'Romance', 'Sci-Fi', 'Sport', 'Thriller', 'War', 'Western'],
		  	genres: ['All'],
    		search: "",
    		sortby: ['title', 1],
    		data: [],
    		showmoviedetails: false,
    		movie: {},
    		status: {
    			mode: 2,
    			message: "Something"
    		}
    	};

    	var t = this;

		mkdirp( path.join(app.getPath('userData'), 'posters') );
		mkdirp( path.join(app.getPath('userData'), 'backdrops') );

		// TO DO: Handle genres better with a genres.db
		db.movies = new Datastore({ filename: path.join(app.getPath('userData'), 'data/movies.json'), autoload: true });
		db.watchfolders = new Datastore({ filename: path.join(app.getPath('userData'), 'data/watchfolders.json'), autoload: true });
		db.files = new Datastore({ filename: path.join(app.getPath('userData'), 'data/files.json'), timestampData: true, autoload: true });

		MM = new MovieMonkey(this, db);

	  	db.movies.find({}).sort({ title: 1 }).exec(function (err, docs) {
	  		t.setState({data: docs});
	  		console.log(docs);
	  	});

	  	this.state.allgenres.forEach(function(item, index){
	  		if(item != 'All')
			  	db.movies.find({genres: { $elemMatch: item } }).exec(function (err, docs) {
			  		if(docs.length == 0) {
			  			t.state.allgenres.splice(t.state.allgenres.indexOf(item), 1);
			  			t.setState({allgenres: t.state.allgenres});
			  		}
			  	});
	  	});

	  	// MM.watch();
	}

	onDragOver(e) {
		e.preventDefault();
	}

	onDrop(e) {
	    e.preventDefault();

		this.setState({status: {mode: 1, message: "🔍 Scanning your files..."}});

		let fileList = [];

		forEachAsync(e.dataTransfer.files, function(next, f, index, array){

			if( fs.lstatSync(f.path).isFile() && isVideo(f.path) ) {
				fileList.push( f.path );
				next();
			}
			else if ( fs.lstatSync(f.path).isDirectory() ) {

				// Add to watchfolders, and remove subdirectories from being watched
				db.watchfolders.update(
					{path: f.path},
					{path: f.path},
					{upsert: true},
					function(e, n, u) {});

				filewalker(f.path)
					.on('file', function(p, s) {
						if( isVideo(p) )
					    	fileList.push( path.join(f.path, p) );
				    })
				    .on('dir', function(p) {

						db.watchfolders.remove({ 
							path: path.join(f.path, p) }, 
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

		db.movies.find({$and: [genreQuery, searchQuery]}).sort(sorting).exec(function (err, docs) {
			t.setState({data: docs});
		});
	}

	// Hide sidebar
	hideSidebar(e) {
	    var t = this;
		db.movies.find({imdbid: e.currentTarget.id}).exec(function (err, docs) {
			t.setState({movie: docs[0], showmoviedetails: true});
		});
	}

	// Hide movie details
	hideMovieDetails(e) {
	    this.setState({showmoviedetails: false});
	}

	openUnidentifiedWindow(e) {
		if (this.state.status.mode == 2) {
			let unWindow = new BrowserWindow({title: "Movie Monkey - Unidentified Files"});

			unWindow.loadURL(url.format({
				pathname: path.join(app.getAppPath(), 'unidentified.html'),
				protocol: 'file:',
				slashes: true
			}));

			unWindow.once('ready-to-show', () => {
				unWindow.show()
			});
		}
		this.setState({status: {mode: 0, message: ""}});
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
				  <Statusbar status={this.state.status} onClick={this.openUnidentifiedWindow} />
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