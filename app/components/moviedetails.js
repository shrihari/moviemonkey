
import React from 'react'
import ReactDOM from 'react-dom'

const remote = require('electron').remote;
const app = remote.app;
const path = require('path');
const shell = require('electron').shell;

export default class MovieDetails extends React.Component {

  constructor(props) {
    super(props);
    this.openFile = this.openFile.bind(this);
  }

  openFile(e) {
    shell.openItem(this.props.movie.fileName);
  }

  render() {
    let t = this;
    // let isShown = (t.props.isShown) ? "movie-details" : "movie-details hide";
    let movie = t.props.movie;

    if (Object.keys(movie).length === 0) return (<div></div>);

    var p = path.join(app.getPath('userData'), "backdrops", movie.backdrop_path);
    var bg = {
      backgroundImage: 'url("' + p + '")',
      backgroundPosition: 'center center',
      backgroundRepeat: 'no-repeat',
      backgroundAttachment: 'fixed',
    };

    var genres = movie.genres.map(function(genre) {
      return (
        <div className="movie-genre" key={genre}>{genre}</div>
      );
    });
    var actors = movie.actors.map(function(actor) {
      return (
        <div className="movie-actor" key={actor}>{actor}</div>
      );
    });
    var directors = movie.directors.map(function(actor) {
      return (
        <div className="movie-actor" key={actor}>{actor}</div>
      );
    });
    var writers = movie.writers.map(function(writer) {
      return (
        <div className="movie-writer" key={writer}>{writer}</div>
      );
    });

    return (
      <div className="movie-details">
		    <div className="movie-backdrop" style={bg}>

          <div className="movie-overlay">

            <div className="movie-poster">

              <img src={path.join(app.getPath('userData'), "posters", movie.poster_path)} />
              <div className="movie-poster-actions">
                <div className="movie-play" onClick={this.openFile}></div>
              </div>
            </div>

            <div className="movie-information">
              <div className="movie-title">{movie.title} <span className="movie-year">({movie.year})</span></div>
              <div className="movie-rating-genres">
                <div className="movie-rating">{movie.imdbrating}</div>
                <div className="movie-genres">{genres}</div>
                <div className="movie-runtime">{movie.runtime} mins</div>
              </div>
              <div className="movie-plot">{movie.plot}</div>
              <div className="movie-actors">
                <div className="movie-actors-title">Actors</div>
                {actors}
              </div>
              <div className="movie-directors">
                <div className="movie-directors-title">Directed by</div>
                {directors}
              </div>
            </div>

          </div>

        </div>
		  </div>
    );
  }
}