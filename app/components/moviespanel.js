
import React from 'react'
import ReactDOM from 'react-dom'

import Movie from './movie.js'

export default class MoviesPanel extends React.Component {

  constructor(props) {
    super(props);
  }

  render() {
    var t = this;
    var movies = this.props.data.map(function(movie) {
      return (
		    <Movie data={movie} key={movie.imdbid} onClick={t.props.onMovieSelect} />
      );
    });
    return (
	    <div id="movies">  

	      {movies}

	    </div>
    );
  }
}