
import React from 'react'
import ReactDOM from 'react-dom'
import Datastore from 'nedb'

export default class Sidebar extends React.Component {
  constructor(props) {
    super(props);
    this.handleGenreChange = this.handleGenreChange.bind(this);
  }

  handleGenreChange(e) {
  	var options = e.target.options;
  	var value = [];

  	for (var i = 0; i < options.length; i++) {
  		if (options[i].selected) {
  			value.push(options[i].value);
  		}
  	}

  	this.props.onGenreChange(value);
  }

  render() {
    let t = this;

    var genres = this.props.allGenres.map(function(genre) {
      return (
		    <option value={genre} key={genre}>{genre}</option>
      );
    });

    return (
		<div id="sidebar">
			<select className={(this.props.isMovieDetailsShown) ? 'hide' : ''} name="genres" id="genres" value={this.props.selectedGenres} onChange={this.handleGenreChange} multiple={true}>
				<option value="All" key="all">All</option>
				{genres}
			</select>
		</div>
    );
  }
}

// defaultValue={this.props.selectedGenres}

// <div id="back" className={(this.props.isMovieDetailsShown) ? '' : 'hide'} onClick={this.props.onBack}></div>

// for (var j = 0; j < newDoc.genres.length; j++) {

// 	console.log("Genres of this movie ", newDoc.genres[j], j);
// 	let xgenre = newDoc.genres[j];

// 	genres_db.find({ gname: xgenre }).exec(function(err, docs){
// 		console.log("Checking ", newDoc.genres[j], xgenre);
// 		console.log(err, docs);

// 		if (docs.length == 0) {
// 			genres_db.insert({ gname: xgenre }, function(err, newDoc2){
// 				console.log(newDoc2.gname, " inserted");
// 			});
// 		}
// 	}); 
// }