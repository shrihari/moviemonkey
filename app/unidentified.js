
import React from 'react'
import ReactDOM from 'react-dom'

import Datastore from 'nedb'

import UnFile from './components/unfile.js'

import MovieMonkey from './core/moviemonkey.js'

const remote = require('electron').remote;
const app = remote.app;

const path = require('path');

var db = {}, MM;

class Unidentified extends React.Component {

	constructor(props) {
		super(props);
		let t = this;

		// TO DO: Handle genres better with a genres.db
		db.movies = new Datastore({ filename: path.join(app.getPath('userData'), 'data/movies.json'), autoload: true });
		db.watchfolders = new Datastore({ filename: path.join(app.getPath('userData'), 'data/watchfolders.json'), autoload: true });
		db.files = new Datastore({ filename: path.join(app.getPath('userData'), 'data/files.json'), timestampData: true, autoload: true });

		MM = new MovieMonkey(this, db);

		this.state = {
			unFiles: []
		};

		// SORT THIS BY DATE
	  	db.files.find({type: "unidentified"}).sort({ createdAt: -1 }).exec(function (err, docs) {
	  		docs.forEach((unFile) => {
				let uf = t.state.unFiles.slice();    
				uf.push(unFile);   
				t.setState({unFiles: uf})
	  		});
	  	});
	}

	render() {
	    var unFiles = this.state.unFiles.map(function(unFile) {
	      return (
			    <UnFile data={unFile} key={unFile._id} onAdd={MM.addMovie}/>
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

ReactDOM.render(
	<Unidentified/>,
	document.getElementById('unidentified-wrapper')
);

