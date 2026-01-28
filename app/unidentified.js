
import React from 'react'
import { createRoot } from 'react-dom/client'

import Datastore from 'nedb'

import UnFile from './components/unfile.js'

import MovieMonkey from './core/moviemonkey.js'

const { ipcRenderer } = require('electron');

const path = require('path');

var db = {};
var userDataPath = null;

class Unidentified extends React.Component {

	constructor(props) {
		super(props);
		this.addedMovie = this.addedMovie.bind(this);

		this.state = {
			unFiles: [],
			userDataPath: null,
			initialized: false
		};

		this.initializeApp();
	}

	async initializeApp() {
		let t = this;
		userDataPath = await ipcRenderer.invoke('get-user-data-path');

		this.setState({ userDataPath, initialized: true });

		// TO DO: Handle genres better with a genres.db
		db.movies = new Datastore({ filename: path.join(userDataPath, 'data/movies.json'), autoload: true });
		db.watchfolders = new Datastore({ filename: path.join(userDataPath, 'data/watchfolders.json'), autoload: true });
		db.files = new Datastore({ filename: path.join(userDataPath, 'data/files.json'), timestampData: true, autoload: true });

	  	db.files.find({type: "unidentified"}).sort({ createdAt: -1 }).exec(function (err, docs) {
	  		let uf = []
	  		docs.forEach((unFile) => {
				uf.push(unFile);
	  		});
			t.setState({unFiles: uf});
	  	});
	}

	addedMovie() {
		let t = this;

	  	db.files.find({type: "unidentified"}).sort({ createdAt: -1 }).exec(function (err, docs) {
	  		let uf = []
	  		docs.forEach((unFile) => {
				uf.push(unFile);
	  		});
			t.setState({unFiles: uf});
	  	});
	}

	render() {
		let t = this;

		if (!this.state.initialized) {
			return <div id="unfiles"><div id="unfiles-desc">Loading...</div></div>;
		}

	    var unFiles = this.state.unFiles.map(function(unFile) {
	      return (
			    <UnFile data={unFile} key={unFile._id} db={db} onAdded={t.addedMovie} userDataPath={t.state.userDataPath}/>
	      );
	    });

		return (
			<div id="unfiles">

				<div id="unfiles-desc">The files below couldn't be identified automatically. You can add them manually.</div>

				{unFiles}
			</div>
		);
	}
}

const root = createRoot(document.getElementById('unidentified-wrapper'));
root.render(<Unidentified/>);
