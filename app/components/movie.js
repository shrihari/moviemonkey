
import React from 'react'
import ReactDOM from 'react-dom'

const remote = require('electron').remote;
const app = remote.app;
const path = require('path');

export default class Movie extends React.Component {

  constructor(props) {
    super(props);
  }

  render() {
  	var movie = this.props.data;

    return (
	      <a href="#" className="movie" onClick={this.props.onClick} id={movie.imdbid}>
    			<div className="image">
            <img src={path.join(app.getPath('userData'), "posters", movie.poster_path)} alt={movie.title} width="100%" />
          </div>
    			<div className="title">{movie.title}</div>
          <div className="meta">
      			<div className="year">{ (movie.type === 'series') ? movie.year.split("–")[0] : movie.year }</div>&nbsp;&nbsp;•&nbsp;&nbsp;
            <div className="rating">{movie.imdbrating}</div>
          </div>
	      </a>
    );
  }
}
